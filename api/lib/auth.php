<?php
/* ============================================================
   Sessions, CSRF, roles.
   Guests = no session user. Roles: viewer < engineer < approver < admin.
   ============================================================ */
declare(strict_types=1);

const ROLE_RANK = ['viewer' => 1, 'engineer' => 2, 'approver' => 3, 'admin' => 4];
const LOGIN_MAX_FAILS = 5;          // per username or IP …
const LOGIN_WINDOW_MIN = 15;        // … within this many minutes
const MIN_PASSWORD_LEN = 10;

function session_start_secure(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $cfg = app_config()['app'];
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($cfg['env'] ?? '') === 'production';
    session_name($cfg['session_name'] ?? 'rocalc_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_start();
}

function csrf_token(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

/** Writes must carry the session's CSRF token in X-CSRF-Token (guests included, e.g. login). */
function require_csrf(): void {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || !is_string($sent) || !hash_equals($_SESSION['csrf'], $sent)) {
        throw new ApiError(403, 'Invalid or missing CSRF token — reload the page');
    }
}

/** Current user row (without password hash) or null for guests. */
function current_user(): ?array {
    static $cache = false;
    if ($cache !== false) return $cache;
    $cache = null;
    $id = $_SESSION['uid'] ?? null;
    if ($id) {
        $st = db()->prepare('SELECT id, username, display_name, email, role, is_active, must_change_password FROM users WHERE id = ?');
        $st->execute([$id]);
        $u = $st->fetch();
        if ($u && $u['is_active']) $cache = numify($u, ['id']);
        else unset($_SESSION['uid']);
    }
    return $cache;
}

function has_role(?array $user, string $min): bool {
    return $user !== null && (ROLE_RANK[$user['role']] ?? 0) >= ROLE_RANK[$min];
}

/** Require a logged-in user with at least $min role. Returns the user. */
function require_role(string $min): array {
    $u = current_user();
    if ($u === null) throw new ApiError(401, 'Login required');
    if (!has_role($u, $min)) throw new ApiError(403, "Requires role '$min' or higher");
    return $u;
}

function login_throttled(string $username, string $ip): bool {
    $st = db()->prepare(
        "SELECT
            count(*) FILTER (WHERE lower(username) = lower(:u)) AS by_user,
            count(*) FILTER (WHERE ip = :ip) AS by_ip
         FROM login_attempts
         WHERE NOT success AND at > now() - make_interval(mins => :w)");
    $st->execute([':u' => $username, ':ip' => $ip, ':w' => LOGIN_WINDOW_MIN]);
    $r = $st->fetch();
    return (int)$r['by_user'] >= LOGIN_MAX_FAILS || (int)$r['by_ip'] >= LOGIN_MAX_FAILS * 4;
}

function validate_password(string $pw): void {
    if (mb_strlen($pw) < MIN_PASSWORD_LEN) {
        throw new ApiError(422, 'Password must be at least ' . MIN_PASSWORD_LEN . ' characters');
    }
}
