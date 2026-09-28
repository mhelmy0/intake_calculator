<?php
/* ============================================================
   Fittings list CSV — parse + validate (PRD §5.5).
   Shared by the import endpoint and the seed script.
   ============================================================ */
declare(strict_types=1);

const FIT_COLUMNS = ['code', 'name', 'category', 'basis', 'n_LD', 'K', 'Kv', 'K1', 'Ki', 'Kd', 'velocity_ref',
                     'dn_min_mm', 'dn_max_mm', 'bom', 'connection', 'status', 'source', 'notes'];
const FIT_REQUIRED = ['code', 'name', 'category', 'basis'];
const FIT_CATEGORIES = ['entrance', 'exit', 'elbow', 'bend', 'tee', 'cross', 'reducer', 'expander', 'flange', 'joint',
                        'valve', 'check_valve', 'strainer', 'meter', 'special'];
const FIT_BASES = ['n', 'K', 'kv', '3k', 'formula'];
const FIT_VELREF = ['segment', 'upstream', 'downstream', 'small_end', 'combined'];
const FIT_CONN = ['none', 'flanged', 'butt_fusion', 'electrofusion', 'welded', 'threaded', 'mechanical'];
const FIT_STATUS = ['verified', 'to_confirm', 'placeholder'];

/**
 * Parse and validate CSV text.
 * @return array{items: array, errors: array, warnings: array}
 *   errors/warnings: [{row, column, message}] — row is the 1-based CSV line (header = 1)
 */
function fittings_parse_csv(string $text, int $maxRows): array {
    $errors = [];
    $warnings = [];
    $items = [];
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);          // strip UTF-8 BOM
    if (!mb_check_encoding($text, 'UTF-8')) {
        return ['items' => [], 'errors' => [['row' => 0, 'column' => '', 'message' => 'File is not UTF-8 — save from Excel as "CSV UTF-8"']], 'warnings' => []];
    }
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, $text);
    rewind($fh);

    $header = fgetcsv($fh, 0, ',', '"', '');
    if (!$header) {
        return ['items' => [], 'errors' => [['row' => 1, 'column' => '', 'message' => 'Empty file']], 'warnings' => []];
    }
    $header = array_map(fn($h) => trim((string)$h), $header);
    $index = [];
    foreach ($header as $i => $h) {
        $match = null;
        foreach (FIT_COLUMNS as $col) if (strcasecmp($col, $h) === 0) $match = $col;
        if ($match === null) { $warnings[] = ['row' => 1, 'column' => $h, 'message' => "Unknown column '$h' ignored"]; continue; }
        $index[$match] = $i;
    }
    foreach (FIT_REQUIRED as $col) {
        if (!isset($index[$col])) $errors[] = ['row' => 1, 'column' => $col, 'message' => "Missing required column '$col'"];
    }
    if ($errors) { fclose($fh); return ['items' => [], 'errors' => $errors, 'warnings' => $warnings]; }

    $line = 1;
    $seen = [];
    while (($rec = fgetcsv($fh, 0, ',', '"', '')) !== false) {
        $line++;
        if ($rec === [null] || implode('', array_map('trim', array_map('strval', $rec))) === '') continue; // blank line
        if (count($items) >= $maxRows) {
            $errors[] = ['row' => $line, 'column' => '', 'message' => "Too many rows (max $maxRows)"];
            break;
        }
        $get = fn(string $c) => isset($index[$c]) ? trim((string)($rec[$index[$c]] ?? '')) : '';
        $err = function (string $col, string $msg) use (&$errors, $line) { $errors[] = ['row' => $line, 'column' => $col, 'message' => $msg]; };
        $num = function (string $col, bool $required, float $min = 0.0, bool $strictMin = false) use ($get, $err): ?float {
            $v = $get($col);
            if ($v === '') { if ($required) $err($col, 'Required for this basis'); return null; }
            if (!is_numeric($v)) { $err($col, "'$v' is not a number (use . as decimal separator)"); return null; }
            $f = (float)$v;
            if ($strictMin ? $f <= $min : $f < $min) { $err($col, 'Must be ' . ($strictMin ? '>' : '≥') . " $min"); return null; }
            return $f;
        };

        $code = $get('code');
        if ($code === '') $err('code', 'Required');
        elseif (!preg_match('/^[A-Za-z0-9._\-]{1,40}$/', $code)) $err('code', 'Use letters, digits, . _ - (max 40)');
        elseif (isset($seen[strtoupper($code)])) $err('code', "Duplicate code '$code' (also on row {$seen[strtoupper($code)]})");
        else $seen[strtoupper($code)] = $line;

        $name = $get('name');
        if ($name === '') $err('name', 'Required');
        elseif (mb_strlen($name) > 120) $err('name', 'Max 120 characters');

        $category = strtolower($get('category'));
        if (!in_array($category, FIT_CATEGORIES, true)) $err('category', "'$category' is not one of: " . implode(', ', FIT_CATEGORIES));

        $basisRaw = $get('basis');
        $basis = null;
        foreach (FIT_BASES as $b) if (strcasecmp($b, $basisRaw) === 0) $basis = $b;
        if ($basis === null) $err('basis', "'$basisRaw' is not one of: " . implode(', ', FIT_BASES));

        $n = $num('n_LD', $basis === 'n', 0.0, true);
        $k = $num('K', $basis === 'K');
        $kv = $num('Kv', false, 0.0, true);
        $k1 = $num('K1', $basis === '3k');
        $ki = $num('Ki', $basis === '3k');
        $kd = $num('Kd', $basis === '3k');
        if ($basis === 'formula') $warnings[] = ['row' => $line, 'column' => 'basis', 'message' => 'basis "formula" is only evaluated for built-in sudden contraction / expansion codes'];
        if ($basis === 'kv' && $kv === null && $get('Kv') === '') $warnings[] = ['row' => $line, 'column' => 'Kv', 'message' => 'No Kv — must be entered per valve in the project'];

        $vel = $get('velocity_ref') === '' ? 'segment' : strtolower($get('velocity_ref'));
        if (!in_array($vel, FIT_VELREF, true)) $err('velocity_ref', "'$vel' is not one of: " . implode(', ', FIT_VELREF));

        $dnMin = $num('dn_min_mm', false);
        $dnMax = $num('dn_max_mm', false);
        if ($dnMin !== null && $dnMax !== null && $dnMin > $dnMax) $err('dn_max_mm', 'dn_max_mm must be ≥ dn_min_mm');

        $bomRaw = strtolower($get('bom'));
        $bom = true;
        if ($bomRaw !== '') {
            if (in_array($bomRaw, ['yes', 'y', 'true', '1'], true)) $bom = true;
            elseif (in_array($bomRaw, ['no', 'n', 'false', '0'], true)) $bom = false;
            else $err('bom', "Use yes / no");
        }
        $conn = $get('connection') === '' ? 'none' : strtolower($get('connection'));
        if (!in_array($conn, FIT_CONN, true)) $err('connection', "'$conn' is not one of: " . implode(', ', FIT_CONN));
        $status = $get('status') === '' ? 'to_confirm' : strtolower($get('status'));
        if (!in_array($status, FIT_STATUS, true)) $err('status', "'$status' is not one of: " . implode(', ', FIT_STATUS));
        if ($get('source') === '') $warnings[] = ['row' => $line, 'column' => 'source', 'message' => 'No source given (recommended)'];

        $items[] = [
            'sort_order' => count($items), 'code' => $code, 'name' => $name, 'category' => $category, 'basis' => $basis,
            'n_ld' => $n, 'k' => $k, 'kv' => $kv, 'k1' => $k1, 'ki' => $ki, 'kd' => $kd, 'velocity_ref' => $vel,
            'dn_min_mm' => $dnMin, 'dn_max_mm' => $dnMax, 'bom' => $bom, 'connection' => $conn, 'status' => $status,
            'source' => mb_substr($get('source'), 0, 200), 'notes' => mb_substr($get('notes'), 0, 500),
        ];
    }
    fclose($fh);
    if (!$items && !$errors) $errors[] = ['row' => 2, 'column' => '', 'message' => 'No data rows'];
    return ['items' => $items, 'errors' => $errors, 'warnings' => $warnings];
}

function fittings_insert_items(int $versionId, array $items): void {
    $st = db()->prepare(
        'INSERT INTO fitting_items (version_id, sort_order, code, name, category, basis, n_ld, k, kv, k1, ki, kd, velocity_ref,
                                    dn_min_mm, dn_max_mm, bom, connection, status, source, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    foreach ($items as $it) {
        $st->execute([$versionId, $it['sort_order'], $it['code'], $it['name'], $it['category'], $it['basis'], $it['n_ld'], $it['k'],
                      $it['kv'], $it['k1'], $it['ki'], $it['kd'], $it['velocity_ref'], $it['dn_min_mm'], $it['dn_max_mm'],
                      $it['bom'] ? 'true' : 'false', $it['connection'], $it['status'], $it['source'], $it['notes']]);
    }
}

/** Serialize items back to CSV (same format as the template). */
function fittings_to_csv(array $items): string {
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, "\xEF\xBB\xBF");
    fputcsv($fh, FIT_COLUMNS, ',', '"', '');
    foreach ($items as $it) {
        fputcsv($fh, [
            $it['code'], $it['name'], $it['category'], $it['basis'], $it['n_ld'], $it['k'], $it['kv'], $it['k1'], $it['ki'], $it['kd'],
            $it['velocity_ref'], $it['dn_min_mm'], $it['dn_max_mm'], $it['bom'] ? 'yes' : 'no', $it['connection'], $it['status'],
            $it['source'], $it['notes'],
        ], ',', '"', '');
    }
    rewind($fh);
    $out = stream_get_contents($fh);
    fclose($fh);
    return $out;
}

/** Compare new items against an existing version's items by code. */
function fittings_diff(array $old, array $new): array {
    $key = fn($it) => strtoupper($it['code']);
    $o = [];
    foreach ($old as $it) $o[$key($it)] = $it;
    $n = [];
    foreach ($new as $it) $n[$key($it)] = $it;
    $fields = ['name', 'category', 'basis', 'n_ld', 'k', 'kv', 'k1', 'ki', 'kd', 'velocity_ref', 'dn_min_mm', 'dn_max_mm', 'bom', 'connection', 'status', 'source', 'notes'];
    $added = $removed = $changed = [];
    foreach ($n as $k => $it) {
        if (!isset($o[$k])) { $added[] = $it['code']; continue; }
        $diffs = [];
        foreach ($fields as $f) {
            $a = $o[$k][$f] ?? null; $b = $it[$f] ?? null;
            if (is_numeric($a) && is_numeric($b) ? (float)$a !== (float)$b : (string)$a !== (string)$b) $diffs[] = $f;
        }
        if ($diffs) $changed[] = ['code' => $it['code'], 'fields' => $diffs];
    }
    foreach ($o as $k => $it) if (!isset($n[$k])) $removed[] = $it['code'];
    return ['added' => $added, 'removed' => $removed, 'changed' => $changed];
}
