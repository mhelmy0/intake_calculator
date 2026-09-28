<?php
/* Recommended default values (PRD: "recommended but user-defined"). Read by all, edited by approvers. */
declare(strict_types=1);

function route_values_list(): never {
    $rows = db()->query('SELECT key, value, unit, label, source, notes, updated_at FROM recommended_values ORDER BY key')->fetchAll();
    $out = [];
    foreach ($rows as $r) $out[$r['key']] = numify($r, ['value']);
    json_out(['values' => $out]);
}

function route_values_update(string $key): never {
    $u = require_role('approver');
    $in = json_body();
    $value = num_field($in, 'value', true);
    $st = db()->prepare('UPDATE recommended_values SET value = ?, source = coalesce(?, source), notes = coalesce(?, notes),
                         updated_at = now(), updated_by = ? WHERE key = ? RETURNING value');
    $st->execute([$value, isset($in['source']) ? str_field($in, 'source', 200, false) : null,
                  isset($in['notes']) ? str_field($in, 'notes', 500, false) : null, $u['id'], $key]);
    if ($st->fetchColumn() === false) throw new ApiError(404, 'Unknown key');
    audit($u['id'], 'update', 'recommended_value', $key, ['value' => $value]);
    json_out(['ok' => true]);
}
