<?php
declare(strict_types=1);

function route_auth_me(): never {
    json_out(['user' => current_user(), 'csrf' => csrf_token()]);
}

function route_auth_login(): never {
    $in = json_body();
    $username = str_field($in, 'username', 80);
    $password = (string)($in['password'] ?? '');
    $ip = client_ip();
    if (login_throttled($username, $ip)) {
        throw new ApiError(429, 'Too many failed attempts — try again in ' . LOGIN_WINDOW_MIN . ' minutes');
    }
    $st = db()->prepare('SELECT id, password_hash, is_active FROM users WHERE lower(username) = lower(?)');
    $st->execute([$username]);
    $u = $st->fetch();
    // Always run password_verify so response time doesn't reveal whether the user exists
    // (hex-encoded: raw random bytes can contain a NUL, which bcrypt rejects with a ValueError → HTTP 500)
    $hash = $u['password_hash'] ?? password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
    $ok = password_verify($password, $hash);
    $ok = $ok && $u && $u['is_active'];
    db()->prepare('INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)')->execute([$username, $ip, $ok ? 'true' : 'false']);
    if (!$ok) throw new ApiError(401, 'Invalid username or password');

    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $u['id']]);
    }
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    unset($_SESSION['csrf']);                         // new token after privilege change
    db()->prepare('UPDATE users SET last_login_at = now() WHERE id = ?')->execute([$u['id']]);
    audit((int)$u['id'], 'login', 'user', (string)$u['id']);
    json_out(['user' => current_user(), 'csrf' => csrf_token()]);
}

function route_auth_logout(): never {
    $u = current_user();
    if ($u) audit($u['id'], 'logout', 'user', (string)$u['id']);
    $_SESSION = [];
    session_regenerate_id(true);
    json_out(['user' => null, 'csrf' => csrf_token()]);
}

function route_auth_password(): never {
    $u = require_role('viewer');
    $in = json_body();
    $current = (string)($in['current'] ?? '');
    $new = (string)($in['new'] ?? '');
    $st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $st->execute([$u['id']]);
    if (!password_verify($current, (string)$st->fetchColumn())) throw new ApiError(403, 'Current password is incorrect');
    validate_password($new);
    if ($new === $current) throw new ApiError(422, 'New password must be different');
    db()->prepare('UPDATE users SET password_hash = ?, must_change_password = FALSE, updated_at = now() WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
    audit($u['id'], 'password_change', 'user', (string)$u['id']);
    session_regenerate_id(true);
    json_out(['ok' => true]);
}
