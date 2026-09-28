<?php
/* ============================================================
   RO Plant Design Calculator — JSON API front controller
   Routes are addressed as  api/index.php/<path>  (PATH_INFO; no rewrite rules needed).
   ============================================================ */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/fittings_csv.php';
require __DIR__ . '/routes/auth.php';
require __DIR__ . '/routes/users.php';
require __DIR__ . '/routes/fittings.php';
require __DIR__ . '/routes/pumps.php';
require __DIR__ . '/routes/values.php';
require __DIR__ . '/routes/equipment.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$ROUTES = [
    // method, pattern, handler
    ['GET',    '#^/auth/me$#',                          'route_auth_me'],
    ['POST',   '#^/auth/login$#',                       'route_auth_login'],
    ['POST',   '#^/auth/logout$#',                      'route_auth_logout'],
    ['POST',   '#^/auth/password$#',                    'route_auth_password'],

    ['GET',    '#^/users$#',                            'route_users_list'],
    ['POST',   '#^/users$#',                            'route_users_create'],
    ['PATCH',  '#^/users/(\d+)$#',                      'route_users_update'],

    ['GET',    '#^/fittings/lists$#',                   'route_fittings_lists'],
    ['GET',    '#^/fittings/recommended$#',             'route_fittings_recommended'],
    ['GET',    '#^/fittings/versions/(\d+)$#',          'route_fittings_version'],
    ['GET',    '#^/fittings/versions/(\d+)/csv$#',      'route_fittings_version_csv'],
    ['POST',   '#^/fittings/import$#',                  'route_fittings_import'],
    ['POST',   '#^/fittings/versions/(\d+)/approve$#',  'route_fittings_approve'],
    ['POST',   '#^/fittings/versions/(\d+)/recommend$#','route_fittings_recommend'],
    ['POST',   '#^/fittings/versions/(\d+)/retire$#',   'route_fittings_retire'],
    ['DELETE', '#^/fittings/versions/(\d+)$#',          'route_fittings_delete'],

    ['GET',    '#^/pumps$#',                            'route_pumps_list'],
    ['GET',    '#^/pumps/(\d+)$#',                      'route_pumps_get'],
    ['POST',   '#^/pumps$#',                            'route_pumps_create'],
    ['PUT',    '#^/pumps/(\d+)$#',                      'route_pumps_update'],
    ['POST',   '#^/pumps/(\d+)/approve$#',              'route_pumps_approve'],
    ['POST',   '#^/pumps/(\d+)/retire$#',               'route_pumps_retire'],
    ['DELETE', '#^/pumps/(\d+)$#',                      'route_pumps_delete'],

    ['GET',    '#^/equipment$#',                        'route_equipment_list'],
    ['GET',    '#^/equipment/(\d+)$#',                  'route_equipment_get'],
    ['POST',   '#^/equipment$#',                        'route_equipment_create'],
    ['PUT',    '#^/equipment/(\d+)$#',                  'route_equipment_update'],
    ['POST',   '#^/equipment/(\d+)/approve$#',          'route_equipment_approve'],
    ['POST',   '#^/equipment/(\d+)/retire$#',           'route_equipment_retire'],
    ['DELETE', '#^/equipment/(\d+)$#',                  'route_equipment_delete'],

    ['GET',    '#^/values$#',                           'route_values_list'],
    ['PUT',    '#^/values/([a-z0-9_.]+)$#',             'route_values_update'],
];

try {
    session_start_secure();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = $_SERVER['PATH_INFO'] ?? ($_GET['r'] ?? '/');
    $path = '/' . trim((string)$path, '/');

    if ($method !== 'GET' && $method !== 'HEAD') require_csrf();

    $allowed = [];
    foreach ($ROUTES as [$m, $pattern, $handler]) {
        if (!preg_match($pattern, $path, $mm)) continue;
        if ($m !== $method) { $allowed[] = $m; continue; }
        array_shift($mm);
        $handler(...array_map(fn($x) => ctype_digit($x) ? (int)$x : $x, $mm));
    }
    if ($allowed) { header('Allow: ' . implode(', ', $allowed)); throw new ApiError(405, 'Method not allowed'); }
    throw new ApiError(404, 'Not found');
} catch (ApiError $e) {
    json_out(['error' => $e->getMessage()] + $e->extra, $e->status);
} catch (PDOException $e) {
    error_log('[rocalc] DB error: ' . $e->getMessage());
    $dev = (app_config()['app']['env'] ?? '') === 'development';
    json_out(['error' => 'Database error' . ($dev ? ': ' . $e->getMessage() : '')], 500);
} catch (Throwable $e) {
    error_log('[rocalc] ' . $e);
    json_out(['error' => 'Server error'], 500);
}
