<?php
/* ============================================================
   Pump library (PRD §7.1). Curve points entered from vendor datasheets.
   Visibility as for fittings: approved for everyone; own drafts for engineers;
   everything for approvers.
   ============================================================ */
declare(strict_types=1);

const PUMP_TYPES = ['submersible', 'vertical_turbine', 'end_suction', 'split_case', 'dewatering', 'other'];
const PUMP_NUM = ['id', 'speed_rpm', 'impeller_mm', 'stages', 'motor_kw', 'voltage_v', 'frequency_hz', 'bep_flow_m3h', 'min_flow_m3h', 'owner_id', 'approved_by'];
const POINT_NUM = ['q_m3h', 'h_m', 'eff_pct', 'npshr_m', 'power_kw'];

function pumps_visible_sql(?array $u): array {
    if (has_role($u, 'approver')) return ['TRUE', []];
    if (has_role($u, 'engineer')) return ["(p.status = 'approved' OR p.owner_id = ?)", [$u['id']]];
    return ["p.status = 'approved'", []];
}

function pumps_load(int $id): array {
    [$vis, $args] = pumps_visible_sql(current_user());
    $st = db()->prepare("SELECT p.*, u.username AS owner_name FROM pumps p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ? AND $vis");
    $st->execute(array_merge([$id], $args));
    $p = $st->fetch();
    if (!$p) throw new ApiError(404, 'Pump not found');
    $p = numify($p, PUMP_NUM);
    $st = db()->prepare('SELECT q_m3h, h_m, eff_pct, npshr_m, power_kw FROM pump_curve_points WHERE pump_id = ? ORDER BY sort_order, q_m3h');
    $st->execute([$id]);
    $p['points'] = array_map(fn($r) => numify($r, POINT_NUM), $st->fetchAll());
    return $p;
}

function route_pumps_list(): never {
    [$vis, $args] = pumps_visible_sql(current_user());
    $includeRetired = !empty($_GET['include_retired']);
    $st = db()->prepare("SELECT p.id, p.vendor, p.model, p.pump_type, p.speed_rpm, p.impeller_mm, p.stages, p.motor_kw, p.bep_flow_m3h,
                                p.status, p.owner_id, u.username AS owner_name, p.updated_at,
                                (SELECT count(*) FROM pump_curve_points c WHERE c.pump_id = p.id) AS point_count
                         FROM pumps p LEFT JOIN users u ON u.id = p.owner_id
                         WHERE $vis " . ($includeRetired ? '' : "AND p.status <> 'retired'") . "
                         ORDER BY lower(p.vendor), lower(p.model)");
    $st->execute($args);
    json_out(['pumps' => array_map(fn($r) => numify($r, array_merge(PUMP_NUM, ['point_count'])), $st->fetchAll())]);
}

/** Load full records (with points) for a set of ids — used by pump selection. */
function route_pumps_get(int $id): never {
    json_out(['pump' => pumps_load($id)]);
}

function pumps_validate(array $in): array {
    $type = (string)($in['pump_type'] ?? 'other');
    if (!in_array($type, PUMP_TYPES, true)) throw new ApiError(422, 'Invalid pump_type');
    $rec = [
        'vendor'        => str_field($in, 'vendor', 80),
        'model'         => str_field($in, 'model', 120),
        'pump_type'     => $type,
        'speed_rpm'     => num_field($in, 'speed_rpm', false, 1, 100000),
        'impeller_mm'   => num_field($in, 'impeller_mm', false, 1, 10000),
        'stages'        => (int)(num_field($in, 'stages', false, 1, 100) ?? 1),
        'motor_kw'      => num_field($in, 'motor_kw', false, 0, 100000),
        'voltage_v'     => num_field($in, 'voltage_v', false, 0, 100000),
        'frequency_hz'  => num_field($in, 'frequency_hz', false, 1, 1000),
        'bep_flow_m3h'  => num_field($in, 'bep_flow_m3h', false, 0, 1e7),
        'min_flow_m3h'  => num_field($in, 'min_flow_m3h', false, 0, 1e7),
        'materials'     => str_field($in, 'materials', 300, false),
        'datasheet_ref' => str_field($in, 'datasheet_ref', 300, false),
        'notes'         => str_field($in, 'notes', 2000, false),
    ];
    $pts = $in['points'] ?? [];
    if (!is_array($pts) || count($pts) < 3) throw new ApiError(422, 'At least 3 curve points (Q, H) are required');
    if (count($pts) > 50) throw new ApiError(422, 'At most 50 curve points');
    $clean = [];
    foreach ($pts as $i => $p) {
        if (!is_array($p)) throw new ApiError(422, "Point " . ($i + 1) . " is invalid");
        $clean[] = [
            'q_m3h'    => num_field($p, 'q_m3h', true, 0, 1e7),
            'h_m'      => num_field($p, 'h_m', true, 0, 1e5),
            'eff_pct'  => num_field($p, 'eff_pct', false, 0, 100),
            'npshr_m'  => num_field($p, 'npshr_m', false, 0, 1000),
            'power_kw' => num_field($p, 'power_kw', false, 0, 1e6),
        ];
    }
    usort($clean, fn($a, $b) => $a['q_m3h'] <=> $b['q_m3h']);
    for ($i = 1; $i < count($clean); $i++) {
        if ($clean[$i]['q_m3h'] == $clean[$i - 1]['q_m3h']) throw new ApiError(422, 'Curve points must have distinct flows');
    }
    return [$rec, $clean];
}

function pumps_write_points(int $pumpId, array $points): void {
    db()->prepare('DELETE FROM pump_curve_points WHERE pump_id = ?')->execute([$pumpId]);
    $st = db()->prepare('INSERT INTO pump_curve_points (pump_id, sort_order, q_m3h, h_m, eff_pct, npshr_m, power_kw) VALUES (?,?,?,?,?,?,?)');
    foreach ($points as $i => $p) $st->execute([$pumpId, $i, $p['q_m3h'], $p['h_m'], $p['eff_pct'], $p['npshr_m'], $p['power_kw']]);
}

function route_pumps_create(): never {
    $u = require_role('engineer');
    [$rec, $points] = pumps_validate(json_body());
    $pdo = db();
    $pdo->beginTransaction();
    $cols = array_keys($rec);
    $st = $pdo->prepare('INSERT INTO pumps (' . implode(',', $cols) . ', owner_id) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?) RETURNING id');
    $st->execute(array_merge(array_values($rec), [$u['id']]));
    $id = (int)$st->fetchColumn();
    pumps_write_points($id, $points);
    audit($u['id'], 'create', 'pump', (string)$id, ['vendor' => $rec['vendor'], 'model' => $rec['model']]);
    $pdo->commit();
    json_out(['pump' => pumps_load($id)], 201);
}

function route_pumps_update(int $id): never {
    $u = require_role('engineer');
    $p = pumps_load($id);
    $isApprover = has_role($u, 'approver');
    if (!$isApprover && ($p['owner_id'] !== $u['id'] || $p['status'] !== 'draft')) {
        throw new ApiError(403, 'Only the owner can edit a draft; approved pumps are edited by approvers');
    }
    [$rec, $points] = pumps_validate(json_body());
    $pdo = db();
    $pdo->beginTransaction();
    $sets = implode(', ', array_map(fn($c) => "$c = ?", array_keys($rec)));
    // An approver editing an approved pump keeps it approved; the change is audited.
    $pdo->prepare("UPDATE pumps SET $sets, updated_at = now() WHERE id = ?")->execute(array_merge(array_values($rec), [$id]));
    pumps_write_points($id, $points);
    audit($u['id'], 'update', 'pump', (string)$id, ['status' => $p['status']]);
    $pdo->commit();
    json_out(['pump' => pumps_load($id)]);
}

function route_pumps_approve(int $id): never {
    $u = require_role('approver');
    $p = pumps_load($id);
    if ($p['status'] !== 'draft') throw new ApiError(409, 'Only drafts can be approved');
    db()->prepare("UPDATE pumps SET status = 'approved', approved_at = now(), approved_by = ? WHERE id = ?")->execute([$u['id'], $id]);
    audit($u['id'], 'approve', 'pump', (string)$id);
    json_out(['pump' => pumps_load($id)]);
}

function route_pumps_retire(int $id): never {
    $u = require_role('approver');
    pumps_load($id);
    db()->prepare("UPDATE pumps SET status = 'retired', updated_at = now() WHERE id = ?")->execute([$id]);
    audit($u['id'], 'retire', 'pump', (string)$id);
    json_out(['pump' => pumps_load($id)]);
}

function route_pumps_delete(int $id): never {
    $u = require_role('engineer');
    $p = pumps_load($id);
    $canDelete = ($p['status'] === 'draft' && $p['owner_id'] === $u['id']) || has_role($u, 'admin');
    if (!$canDelete) throw new ApiError(403, 'Only the owner can delete a draft (admins can delete any pump)');
    db()->prepare('DELETE FROM pumps WHERE id = ?')->execute([$id]);
    audit($u['id'], 'delete', 'pump', (string)$id, ['vendor' => $p['vendor'], 'model' => $p['model']]);
    json_out(['ok' => true]);
}
