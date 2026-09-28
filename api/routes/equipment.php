<?php
/* ============================================================
   Pretreatment equipment list (Pretreatment PRD v0.2 §1A):
   MMF vessels, bag filter elements / housings, cartridge elements / housings.
   Visibility and life cycle as for pumps: approved for everyone; own drafts
   for engineers; everything for approvers.
   ============================================================ */
declare(strict_types=1);

/* category => [field => [type, required, min, max]]   type: n = number, s = string (with allowed values) */
const EQUIP_SPECS = [
    'mmf_vessel' => [
        'orientation'         => ['s', true, ['vertical', 'horizontal']],
        'diameter_m'          => ['n', true, 0.3, 6],
        'shell_length_m'      => ['n', false, 0.3, 30],
        'area_m2'             => ['n', false, 0.05, 200],
        'design_pressure_bar' => ['n', false, 0, 40],
        'max_rate_m_h'        => ['n', false, 1, 60],
    ],
    'bag_element' => [
        'size'        => ['s', false, ['#1', '#2', '#3', '#4', 'custom']],
        'micron'      => ['n', true, 0.1, 2000],
        'flow_m3h'    => ['n', true, 0.1, 500],
        'length_mm'   => ['n', false, 50, 2000],
    ],
    'bag_housing' => [
        'bags'                => ['n', true, 1, 100],
        'size'                => ['s', false, ['#1', '#2', '#3', '#4', 'custom']],
        'max_flow_m3h'        => ['n', false, 0.1, 10000],
        'design_pressure_bar' => ['n', false, 0, 40],
    ],
    'cartridge_element' => [
        'type'       => ['s', true, ['standard', 'high_flow']],
        'length_in'  => ['n', true, 5, 80],
        'od_mm'      => ['n', false, 20, 300],
        'micron'     => ['n', true, 0.1, 200],
        'q10_m3h'    => ['n', false, 0.05, 20],
        'flow_m3h'   => ['n', false, 0.1, 200],
    ],
    'cartridge_housing' => [
        'elements'            => ['n', true, 1, 1000],
        'length_in'           => ['n', false, 5, 80],
        'max_flow_m3h'        => ['n', false, 0.1, 20000],
        'design_pressure_bar' => ['n', false, 0, 40],
    ],
];
const EQUIP_NUM = ['id', 'owner_id', 'approved_by'];

function equip_visible_sql(?array $u): array {
    if (has_role($u, 'approver')) return ['TRUE', []];
    if (has_role($u, 'engineer')) return ["(e.status = 'approved' OR e.owner_id = ?)", [$u['id']]];
    return ["e.status = 'approved'", []];
}

function equip_row(array $r): array {
    $r = numify($r, EQUIP_NUM);
    $r['specs'] = json_decode((string)$r['specs'], true) ?: new stdClass();
    return $r;
}

function equip_load(int $id): array {
    [$vis, $args] = equip_visible_sql(current_user());
    $st = db()->prepare("SELECT e.*, u.username AS owner_name FROM equipment e LEFT JOIN users u ON u.id = e.owner_id WHERE e.id = ? AND $vis");
    $st->execute(array_merge([$id], $args));
    $r = $st->fetch();
    if (!$r) throw new ApiError(404, 'Equipment not found');
    return equip_row($r);
}

function route_equipment_list(): never {
    [$vis, $args] = equip_visible_sql(current_user());
    $cat = (string)($_GET['category'] ?? '');
    $where = "WHERE $vis" . (empty($_GET['include_retired']) ? " AND e.status <> 'retired'" : '');
    if ($cat !== '') {
        if (!isset(EQUIP_SPECS[$cat])) throw new ApiError(422, 'Unknown category');
        $where .= ' AND e.category = ?';
        $args[] = $cat;
    }
    $st = db()->prepare("SELECT e.*, u.username AS owner_name FROM equipment e LEFT JOIN users u ON u.id = e.owner_id $where ORDER BY e.category, lower(e.vendor), lower(e.model)");
    $st->execute($args);
    json_out(['equipment' => array_map('equip_row', $st->fetchAll())]);
}

function route_equipment_get(int $id): never {
    json_out(['equipment' => equip_load($id)]);
}

function equip_validate(array $in): array {
    $cat = (string)($in['category'] ?? '');
    if (!isset(EQUIP_SPECS[$cat])) throw new ApiError(422, 'Invalid category');
    $specsIn = is_array($in['specs'] ?? null) ? $in['specs'] : [];
    $unknown = array_diff(array_keys($specsIn), array_keys(EQUIP_SPECS[$cat]));
    if ($unknown) throw new ApiError(422, 'Unknown spec field(s): ' . implode(', ', $unknown));
    $specs = [];
    foreach (EQUIP_SPECS[$cat] as $k => $def) {
        if ($def[0] === 'n') {
            $v = num_field($specsIn, $k, $def[1], $def[2], $def[3]);
            if ($v !== null) $specs[$k] = $v;
        } else {
            $v = isset($specsIn[$k]) ? trim((string)$specsIn[$k]) : '';
            if ($v === '') { if ($def[1]) throw new ApiError(422, "Field '$k' is required"); continue; }
            if (!in_array($v, $def[2], true)) throw new ApiError(422, "Invalid value for '$k'");
            $specs[$k] = $v;
        }
    }
    if ($cat === 'cartridge_element' && !isset($specs['q10_m3h']) && !isset($specs['flow_m3h'])) {
        throw new ApiError(422, 'Enter the rated flow per 10 inch or per element');
    }
    return [
        'category'      => $cat,
        'vendor'        => str_field($in, 'vendor', 80),
        'model'         => str_field($in, 'model', 120),
        'specs'         => json_encode($specs, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION),
        'datasheet_ref' => str_field($in, 'datasheet_ref', 300, false),
        'notes'         => str_field($in, 'notes', 2000, false),
    ];
}

function route_equipment_create(): never {
    $u = require_role('engineer');
    $rec = equip_validate(json_body());
    $cols = array_keys($rec);
    $st = db()->prepare('INSERT INTO equipment (' . implode(',', $cols) . ', owner_id) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?) RETURNING id');
    $st->execute(array_merge(array_values($rec), [$u['id']]));
    $id = (int)$st->fetchColumn();
    audit($u['id'], 'create', 'equipment', (string)$id, ['category' => $rec['category'], 'vendor' => $rec['vendor'], 'model' => $rec['model']]);
    json_out(['equipment' => equip_load($id)], 201);
}

function route_equipment_update(int $id): never {
    $u = require_role('engineer');
    $e = equip_load($id);
    if (!has_role($u, 'approver') && ($e['owner_id'] !== $u['id'] || $e['status'] !== 'draft')) {
        throw new ApiError(403, 'Only the owner can edit a draft; approved entries are edited by approvers');
    }
    $rec = equip_validate(json_body());
    $sets = implode(', ', array_map(fn($c) => "$c = ?", array_keys($rec)));
    db()->prepare("UPDATE equipment SET $sets, updated_at = now() WHERE id = ?")->execute(array_merge(array_values($rec), [$id]));
    audit($u['id'], 'update', 'equipment', (string)$id, ['status' => $e['status']]);
    json_out(['equipment' => equip_load($id)]);
}

function route_equipment_approve(int $id): never {
    $u = require_role('approver');
    $e = equip_load($id);
    if ($e['status'] !== 'draft') throw new ApiError(409, 'Only drafts can be approved');
    db()->prepare("UPDATE equipment SET status = 'approved', approved_at = now(), approved_by = ? WHERE id = ?")->execute([$u['id'], $id]);
    audit($u['id'], 'approve', 'equipment', (string)$id);
    json_out(['equipment' => equip_load($id)]);
}

function route_equipment_retire(int $id): never {
    $u = require_role('approver');
    equip_load($id);
    db()->prepare("UPDATE equipment SET status = 'retired', updated_at = now() WHERE id = ?")->execute([$id]);
    audit($u['id'], 'retire', 'equipment', (string)$id);
    json_out(['equipment' => equip_load($id)]);
}

function route_equipment_delete(int $id): never {
    $u = require_role('engineer');
    $e = equip_load($id);
    if (!(($e['status'] === 'draft' && $e['owner_id'] === $u['id']) || has_role($u, 'admin'))) {
        throw new ApiError(403, 'Only the owner can delete a draft (admins can delete any entry)');
    }
    db()->prepare('DELETE FROM equipment WHERE id = ?')->execute([$id]);
    audit($u['id'], 'delete', 'equipment', (string)$id, ['vendor' => $e['vendor'], 'model' => $e['model']]);
    json_out(['ok' => true]);
}
