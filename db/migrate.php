<?php
/* ============================================================
   Database setup (CLI only)
     php db/migrate.php                       apply migrations + seed
     php db/migrate.php --create-admin=NAME   also create an admin user
                                              (prints a one-time password; change it at first login)
     php db/migrate.php --reset-password=NAME new one-time password for NAME
   ============================================================ */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require __DIR__ . '/../api/lib/bootstrap.php';
require __DIR__ . '/../api/lib/fittings_csv.php';

$opts = getopt('', ['create-admin:', 'reset-password:']);
$pdo = db();

// ---------- migrations ----------
$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
$done = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
$files = glob(__DIR__ . '/migrations/*.sql');
sort($files);
foreach ($files as $f) {
    $v = basename($f, '.sql');
    if (in_array($v, $done, true)) continue;
    echo "Applying $v … ";
    $pdo->beginTransaction();
    try {
        $pdo->exec(file_get_contents($f));
        $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (?)')->execute([$v]);
        $pdo->commit();
        echo "ok\n";
    } catch (Throwable $e) {
        $pdo->rollBack();
        fwrite(STDERR, "FAILED: {$e->getMessage()}\n");
        exit(1);
    }
}

// ---------- recommended values ----------
$vals = require __DIR__ . '/seed_values.php';
$st = $pdo->prepare('INSERT INTO recommended_values (key, value, unit, label, source, notes) VALUES (?,?,?,?,?,?) ON CONFLICT (key) DO NOTHING');
$n = 0;
foreach ($vals as $key => [$value, $unit, $label, $source, $notes]) {
    $st->execute([$key, $value, $unit, $label, $source, $notes]);
    $n += $st->rowCount();
}
echo "Recommended values: $n new\n";

// ---------- recommended fittings list ----------
if ((int)$pdo->query('SELECT count(*) FROM fitting_lists')->fetchColumn() === 0) {
    $csvFile = APP_ROOT . '/assets/data/fittings/fittings_recommended_v1.csv';
    $parsed = fittings_parse_csv(file_get_contents($csvFile), 5000);
    if ($parsed['errors']) {
        fwrite(STDERR, "Seed CSV has errors:\n" . json_encode($parsed['errors'], JSON_PRETTY_PRINT) . "\n");
        exit(1);
    }
    $pdo->beginTransaction();
    $pdo->prepare("INSERT INTO fitting_lists (name, description) VALUES (?, ?)")
        ->execute(['RO-Calc Recommended Fittings', 'Crane TP-410 based default list (PRD §5.4)']);
    $listId = (int)$pdo->lastInsertId();
    $pdo->prepare("INSERT INTO fitting_list_versions (list_id, version, status, is_recommended, source, notes, imported_filename, approved_at)
                   VALUES (?, 1, 'approved', TRUE, 'Crane TP-410; typical values where marked', 'Seed data', ?, now())")
        ->execute([$listId, basename($csvFile)]);
    fittings_insert_items((int)$pdo->lastInsertId(), $parsed['items']);
    $pdo->commit();
    echo 'Fittings: seeded recommended list (' . count($parsed['items']) . " items)\n";
}

// ---------- admin user ----------
if (!empty($opts['create-admin'])) {
    $name = trim($opts['create-admin']);
    $exists = $pdo->prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)');
    $exists->execute([$name]);
    if ($exists->fetchColumn()) {
        echo "User '$name' already exists — not changed\n";
    } else {
        $pw = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'Kx'), '=');
        $pdo->prepare("INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'admin', TRUE)")
            ->execute([$name, $name, password_hash($pw, PASSWORD_DEFAULT)]);
        echo "Admin '$name' created. One-time password: $pw\n(must be changed at first login)\n";
    }
}
// ---------- password reset (e.g. lost admin password) ----------
if (!empty($opts['reset-password'])) {
    $name = trim($opts['reset-password']);
    $pw = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'Kx'), '=');
    $st = $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = TRUE, is_active = TRUE, updated_at = now() WHERE lower(username) = lower(?)');
    $st->execute([password_hash($pw, PASSWORD_DEFAULT), $name]);
    echo $st->rowCount() ? "Password for '$name' reset. One-time password: $pw\n(must be changed at first login)\n" : "No user '$name'\n";
}
echo "Done.\n";
