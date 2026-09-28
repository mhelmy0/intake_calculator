<?php
/* ============================================================
   RO Plant Design Calculator — API bootstrap
   Config, PDO connection, JSON responses, errors.
   ============================================================ */
declare(strict_types=1);

const APP_ROOT = __DIR__ . '/../..';

function app_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        // ROCALC_CONFIG lets tests / CLI point at another config (e.g. a test database)
        $file = getenv('ROCALC_CONFIG') ?: APP_ROOT . '/config/config.local.php';
        if (!is_file($file)) {
            throw new RuntimeException('Missing config/config.local.php — copy config/config.sample.php');
        }
        $cfg = require $file;
    }
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = app_config()['db'];
        $pdo = new PDO($c['dsn'], $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

/** Thrown by handlers to produce a JSON error with an HTTP status. */
final class ApiError extends RuntimeException {
    public function __construct(public int $status, string $message, public array $extra = []) {
        parent::__construct($message);
    }
}

function json_out(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function json_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new ApiError(400, 'Request body must be a JSON object');
    return $data;
}

function client_ip(): string {
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function audit(?int $userId, string $action, string $entity, ?string $entityId = null, ?array $detail = null): void {
    $st = db()->prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)');
    $st->execute([$userId, $action, $entity, $entityId, $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE)]);
}

/** Cast NUMERIC columns (returned as strings by pdo_pgsql) to float/int for JSON. */
function numify(array $row, array $cols): array {
    foreach ($cols as $c) {
        if (array_key_exists($c, $row) && $row[$c] !== null) $row[$c] = $row[$c] + 0;
    }
    return $row;
}

function str_field(array $in, string $key, int $max = 200, bool $required = true): string {
    $v = isset($in[$key]) ? trim((string)$in[$key]) : '';
    if ($required && $v === '') throw new ApiError(422, "Field '$key' is required");
    if (mb_strlen($v) > $max) throw new ApiError(422, "Field '$key' is too long (max $max)");
    return $v;
}

function num_field(array $in, string $key, bool $required = false, ?float $min = null, ?float $max = null): ?float {
    if (!isset($in[$key]) || $in[$key] === '' || $in[$key] === null) {
        if ($required) throw new ApiError(422, "Field '$key' is required");
        return null;
    }
    if (!is_numeric($in[$key])) throw new ApiError(422, "Field '$key' must be a number");
    $v = (float)$in[$key];
    if (!is_finite($v) || ($min !== null && $v < $min) || ($max !== null && $v > $max)) {
        throw new ApiError(422, "Field '$key' is out of range");
    }
    return $v;
}
