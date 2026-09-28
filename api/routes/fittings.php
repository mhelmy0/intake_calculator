<?php
/* ============================================================
   Fittings library — versioned lists, CSV import/export (PRD §5.4–5.5)
   Visibility: guests/viewers see approved versions; engineers also their own
   drafts; approvers/admins see everything.
   ============================================================ */
declare(strict_types=1);

const FIT_NUM_COLS = ['id', 'version_id', 'sort_order', 'n_ld', 'k', 'kv', 'k1', 'ki', 'kd', 'dn_min_mm', 'dn_max_mm'];

function fittings_visible_sql(?array $u, string $alias = 'v'): array {
    if (has_role($u, 'approver')) return ['TRUE', []];
    if (has_role($u, 'engineer')) return ["($alias.status = 'approved' OR $alias.created_by = ?)", [$u['id']]];
    return ["$alias.status = 'approved'", []];
}

function fittings_load_version(int $id): array {
    $u = current_user();
    [$vis, $args] = fittings_visible_sql($u);
    $st = db()->prepare("SELECT v.*, l.name AS list_name, l.description AS list_description
                         FROM fitting_list_versions v JOIN fitting_lists l ON l.id = v.list_id
                         WHERE v.id = ? AND $vis");
    $st->execute(array_merge([$id], $args));
    $v = $st->fetch();
    if (!$v) throw new ApiError(404, 'List version not found');
    return numify($v, ['id', 'list_id', 'version', 'created_by', 'approved_by']);
}

function fittings_items(int $versionId): array {
    $st = db()->prepare('SELECT * FROM fitting_items WHERE version_id = ? ORDER BY sort_order, id');
    $st->execute([$versionId]);
    return array_map(fn($r) => numify($r, FIT_NUM_COLS), $st->fetchAll());
}

function route_fittings_lists(): never {
    [$vis, $args] = fittings_visible_sql(current_user());
    $st = db()->prepare("SELECT v.id, v.list_id, l.name AS list_name, l.description, v.version, v.status, v.is_recommended,
                                v.source, v.notes, v.created_at, v.approved_at, u.username AS created_by_name,
                                (SELECT count(*) FROM fitting_items i WHERE i.version_id = v.id) AS item_count
                         FROM fitting_list_versions v
                         JOIN fitting_lists l ON l.id = v.list_id
                         LEFT JOIN users u ON u.id = v.created_by
                         WHERE $vis
                         ORDER BY v.is_recommended DESC, lower(l.name), v.version DESC");
    $st->execute($args);
    json_out(['versions' => array_map(fn($r) => numify($r, ['id', 'list_id', 'version', 'item_count']), $st->fetchAll())]);
}

function route_fittings_recommended(): never {
    $id = db()->query('SELECT id FROM fitting_list_versions WHERE is_recommended LIMIT 1')->fetchColumn();
    if (!$id) throw new ApiError(404, 'No recommended fittings list');
    $v = fittings_load_version((int)$id);
    json_out(['version' => $v, 'items' => fittings_items($v['id'])]);
}

function route_fittings_version(int $id): never {
    $v = fittings_load_version($id);
    json_out(['version' => $v, 'items' => fittings_items($id)]);
}

function route_fittings_version_csv(int $id): never {
    $v = fittings_load_version($id);
    $name = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $v['list_name']) . '_v' . $v['version'] . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');
    echo fittings_to_csv(fittings_items($id));
    exit;
}

/**
 * Body: { csv, filename?, mode: "new"|"version", list_id? (mode=version), name?, description? (mode=new),
 *         source?, notes?, validate_only?: bool }
 * Guests may validate only (nothing is stored). Saving requires engineer+ and creates a draft.
 */
function route_fittings_import(): never {
    $u = current_user();
    $in = json_body();
    $cfg = app_config()['app'];
    $csv = (string)($in['csv'] ?? '');
    if ($csv === '') throw new ApiError(422, 'No CSV content');
    if (strlen($csv) > ($cfg['max_import_kb'] ?? 1024) * 1024) throw new ApiError(413, 'File too large');
    $validateOnly = !empty($in['validate_only']);
    if (!$validateOnly) require_role('engineer');

    $parsed = fittings_parse_csv($csv, (int)($cfg['max_import_rows'] ?? 2000));
    $mode = ($in['mode'] ?? 'new') === 'version' ? 'version' : 'new';
    $diff = null;
    $listId = null;
    if ($mode === 'version') {
        $listId = (int)($in['list_id'] ?? 0);
        $st = db()->prepare('SELECT v.id FROM fitting_list_versions v WHERE v.list_id = ? ORDER BY v.version DESC LIMIT 1');
        $st->execute([$listId]);
        $latest = $st->fetchColumn();
        if (!$latest) throw new ApiError(404, 'List not found');
        $diff = fittings_diff(fittings_items((int)$latest), $parsed['items']);
    }
    $report = ['items' => $parsed['items'], 'errors' => $parsed['errors'], 'warnings' => $parsed['warnings'], 'diff' => $diff];
    if ($validateOnly || $parsed['errors']) {
        json_out($report + ['saved' => false], $parsed['errors'] && !$validateOnly ? 422 : 200);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($mode === 'new') {
            $name = str_field($in, 'name', 120);
            $pdo->prepare('INSERT INTO fitting_lists (name, description, created_by) VALUES (?, ?, ?)')
                ->execute([$name, str_field($in, 'description', 500, false), $u['id']]);
            $listId = (int)$pdo->lastInsertId();
            $version = 1;
        } else {
            $st = $pdo->prepare('SELECT coalesce(max(version), 0) + 1 FROM fitting_list_versions WHERE list_id = ?');
            $st->execute([$listId]);
            $version = (int)$st->fetchColumn();
        }
        $pdo->prepare("INSERT INTO fitting_list_versions (list_id, version, status, source, notes, imported_filename, created_by)
                       VALUES (?, ?, 'draft', ?, ?, ?, ?)")
            ->execute([$listId, $version, str_field($in, 'source', 200, false), str_field($in, 'notes', 1000, false),
                       mb_substr((string)($in['filename'] ?? ''), 0, 200) ?: null, $u['id']]);
        $versionId = (int)$pdo->lastInsertId();
        fittings_insert_items($versionId, $parsed['items']);
        audit($u['id'], 'import', 'fitting_list_version', (string)$versionId, ['list_id' => $listId, 'version' => $version, 'rows' => count($parsed['items'])]);
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() === '23505') throw new ApiError(409, 'A list with this name already exists — import as a new version instead');
        throw $e;
    }
    json_out($report + ['saved' => true, 'version_id' => $versionId, 'list_id' => $listId, 'version' => $version], 201);
}

function fittings_set_status(int $id, string $action): never {
    $u = require_role('approver');
    $v = fittings_load_version($id);
    $pdo = db();
    $pdo->beginTransaction();
    if ($action === 'approve') {
        if ($v['status'] !== 'draft') throw new ApiError(409, 'Only drafts can be approved');
        $pdo->prepare("UPDATE fitting_list_versions SET status = 'approved', approved_at = now(), approved_by = ? WHERE id = ?")->execute([$u['id'], $id]);
    } elseif ($action === 'recommend') {
        if ($v['status'] !== 'approved') throw new ApiError(409, 'Only approved versions can be recommended');
        $pdo->exec('UPDATE fitting_list_versions SET is_recommended = FALSE WHERE is_recommended');
        $pdo->prepare('UPDATE fitting_list_versions SET is_recommended = TRUE WHERE id = ?')->execute([$id]);
    } elseif ($action === 'retire') {
        if ($v['is_recommended']) throw new ApiError(409, 'Recommend another list before retiring this one');
        $pdo->prepare("UPDATE fitting_list_versions SET status = 'retired' WHERE id = ?")->execute([$id]);
    }
    audit($u['id'], $action, 'fitting_list_version', (string)$id);
    $pdo->commit();
    json_out(['ok' => true, 'version' => fittings_load_version($id)]);
}
function route_fittings_approve(int $id): never   { fittings_set_status($id, 'approve'); }
function route_fittings_recommend(int $id): never { fittings_set_status($id, 'recommend'); }
function route_fittings_retire(int $id): never    { fittings_set_status($id, 'retire'); }

function route_fittings_delete(int $id): never {
    $u = require_role('engineer');
    $v = fittings_load_version($id);
    if ($v['status'] !== 'draft') throw new ApiError(409, 'Only drafts can be deleted — retire approved lists instead');
    if ($v['created_by'] !== $u['id'] && !has_role($u, 'approver')) throw new ApiError(403, 'Not your draft');
    $pdo = db();
    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM fitting_list_versions WHERE id = ?')->execute([$id]);
    // remove the list itself if it has no versions left
    $pdo->prepare('DELETE FROM fitting_lists l WHERE l.id = ? AND NOT EXISTS (SELECT 1 FROM fitting_list_versions v WHERE v.list_id = l.id)')
        ->execute([$v['list_id']]);
    audit($u['id'], 'delete', 'fitting_list_version', (string)$id);
    $pdo->commit();
    json_out(['ok' => true]);
}
