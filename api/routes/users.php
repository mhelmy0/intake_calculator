<?php
/* Admin-only user management. Users are never self-registered (PRD §9.1). */
declare(strict_types=1);

function route_users_list(): never {
    require_role('admin');
    $rows = db()->query('SELECT id, username, display_name, email, role, is_active, must_change_password, created_at, last_login_at
                         FROM users ORDER BY lower(username)')->fetchAll();
    json_out(['users' => array_map(fn($r) => numify($r, ['id']), $rows)]);
}

function route_users_create(): never {
    $admin = require_role('admin');
    $in = json_body();
    $username = str_field($in, 'username', 60);
    if (!preg_match('/^[A-Za-z0-9._\-]{3,60}$/', $username)) throw new ApiError(422, 'Username: 3–60 letters, digits, . _ -');
    $role = (string)($in['role'] ?? 'engineer');
    if (!isset(ROLE_RANK[$role])) throw new ApiError(422, 'Invalid role');
    $password = (string)($in['password'] ?? '');
    validate_password($password);
    $st = db()->prepare('INSERT INTO users (username, display_name, email, password_hash, role, must_change_password, created_by)
                         VALUES (?, ?, ?, ?, ?, TRUE, ?) RETURNING id');
    try {
        $st->execute([$username, str_field($in, 'display_name', 120, false) ?: $username, str_field($in, 'email', 200, false) ?: null,
                      password_hash($password, PASSWORD_DEFAULT), $role, $admin['id']]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23505') throw new ApiError(409, 'Username already exists');
        throw $e;
    }
    $id = (int)$st->fetchColumn();
    audit($admin['id'], 'create', 'user', (string)$id, ['username' => $username, 'role' => $role]);
    json_out(['id' => $id], 201);
}

function route_users_update(int $id): never {
    $admin = require_role('admin');
    $in = json_body();
    $sets = [];
    $args = [];
    if (array_key_exists('role', $in)) {
        if (!isset(ROLE_RANK[$in['role']])) throw new ApiError(422, 'Invalid role');
        if ($id === $admin['id'] && $in['role'] !== 'admin') throw new ApiError(422, 'You cannot remove your own admin role');
        $sets[] = 'role = ?'; $args[] = $in['role'];
    }
    if (array_key_exists('is_active', $in)) {
        if ($id === $admin['id'] && !$in['is_active']) throw new ApiError(422, 'You cannot deactivate yourself');
        $sets[] = 'is_active = ?'; $args[] = $in['is_active'] ? 'true' : 'false';
    }
    if (array_key_exists('display_name', $in)) { $sets[] = 'display_name = ?'; $args[] = str_field($in, 'display_name', 120, false); }
    if (array_key_exists('email', $in)) { $sets[] = 'email = ?'; $args[] = str_field($in, 'email', 200, false) ?: null; }
    if (array_key_exists('password', $in)) {
        validate_password((string)$in['password']);
        $sets[] = 'password_hash = ?'; $args[] = password_hash((string)$in['password'], PASSWORD_DEFAULT);
        $sets[] = 'must_change_password = TRUE';
    }
    if (!$sets) throw new ApiError(422, 'Nothing to update');
    $sets[] = 'updated_at = now()';
    $args[] = $id;
    $st = db()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $st->execute($args);
    if (!$st->rowCount()) throw new ApiError(404, 'User not found');
    $logged = $in;
    unset($logged['password']);
    audit($admin['id'], 'update', 'user', (string)$id, $logged + (isset($in['password']) ? ['password' => 'reset'] : []));
    json_out(['ok' => true]);
}
