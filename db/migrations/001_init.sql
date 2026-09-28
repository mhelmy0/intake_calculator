-- ============================================================
-- RO Plant Design Calculator — initial schema (PostgreSQL 14+)
-- ============================================================

-- ---------- Users & security ----------
CREATE TABLE users (
    id                    BIGSERIAL PRIMARY KEY,
    username              TEXT NOT NULL,
    display_name          TEXT NOT NULL DEFAULT '',
    email                 TEXT,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('viewer', 'engineer', 'approver', 'admin')),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            BIGINT REFERENCES users(id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_ci ON users (lower(username));

CREATE TABLE login_attempts (
    id        BIGSERIAL PRIMARY KEY,
    username  TEXT NOT NULL,
    ip        TEXT NOT NULL,
    success   BOOLEAN NOT NULL,
    at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_lookup ON login_attempts (lower(username), at DESC);
CREATE INDEX login_attempts_ip ON login_attempts (ip, at DESC);

CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id    BIGINT REFERENCES users(id),
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT,
    detail     JSONB
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);

-- ---------- Fittings library (versioned lists) ----------
CREATE TABLE fitting_lists (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   BIGINT REFERENCES users(id)
);
CREATE UNIQUE INDEX fitting_lists_name_ci ON fitting_lists (lower(name));

CREATE TABLE fitting_list_versions (
    id                 BIGSERIAL PRIMARY KEY,
    list_id            BIGINT NOT NULL REFERENCES fitting_lists(id) ON DELETE CASCADE,
    version            INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
    is_recommended     BOOLEAN NOT NULL DEFAULT FALSE,
    source             TEXT NOT NULL DEFAULT '',
    notes              TEXT NOT NULL DEFAULT '',
    imported_filename  TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         BIGINT REFERENCES users(id),
    approved_at        TIMESTAMPTZ,
    approved_by        BIGINT REFERENCES users(id),
    UNIQUE (list_id, version),
    CHECK (NOT is_recommended OR status = 'approved')
);
-- Only one recommended version in the whole library
CREATE UNIQUE INDEX fitting_one_recommended ON fitting_list_versions (is_recommended) WHERE is_recommended;

CREATE TABLE fitting_items (
    id            BIGSERIAL PRIMARY KEY,
    version_id    BIGINT NOT NULL REFERENCES fitting_list_versions(id) ON DELETE CASCADE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL CHECK (category IN ('entrance','exit','elbow','bend','tee','cross','reducer','expander',
                                                    'flange','joint','valve','check_valve','strainer','meter','special')),
    basis         TEXT NOT NULL CHECK (basis IN ('n','K','kv','3k','formula')),
    n_ld          NUMERIC,
    k             NUMERIC,
    kv            NUMERIC,
    k1            NUMERIC,
    ki            NUMERIC,
    kd            NUMERIC,
    velocity_ref  TEXT NOT NULL DEFAULT 'segment' CHECK (velocity_ref IN ('segment','upstream','downstream','small_end','combined')),
    dn_min_mm     NUMERIC,
    dn_max_mm     NUMERIC,
    bom           BOOLEAN NOT NULL DEFAULT TRUE,
    connection    TEXT NOT NULL DEFAULT 'none' CHECK (connection IN ('none','flanged','butt_fusion','electrofusion','welded','threaded','mechanical')),
    status        TEXT NOT NULL DEFAULT 'to_confirm' CHECK (status IN ('verified','to_confirm','placeholder')),
    source        TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    UNIQUE (version_id, code)
);

-- ---------- Pump library ----------
CREATE TABLE pumps (
    id              BIGSERIAL PRIMARY KEY,
    vendor          TEXT NOT NULL,
    model           TEXT NOT NULL,
    pump_type       TEXT NOT NULL DEFAULT 'other'
                    CHECK (pump_type IN ('submersible','vertical_turbine','end_suction','split_case','dewatering','other')),
    speed_rpm       NUMERIC,
    impeller_mm     NUMERIC,
    stages          INTEGER NOT NULL DEFAULT 1 CHECK (stages >= 1),
    motor_kw        NUMERIC,
    voltage_v       NUMERIC,
    frequency_hz    NUMERIC,
    bep_flow_m3h    NUMERIC,
    min_flow_m3h    NUMERIC,
    materials       TEXT NOT NULL DEFAULT '',
    datasheet_ref   TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    owner_id        BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    approved_by     BIGINT REFERENCES users(id)
);
CREATE INDEX pumps_status ON pumps (status);

CREATE TABLE pump_curve_points (
    id          BIGSERIAL PRIMARY KEY,
    pump_id     BIGINT NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    q_m3h       NUMERIC NOT NULL CHECK (q_m3h >= 0),
    h_m         NUMERIC NOT NULL,
    eff_pct     NUMERIC CHECK (eff_pct IS NULL OR (eff_pct >= 0 AND eff_pct <= 100)),
    npshr_m     NUMERIC CHECK (npshr_m IS NULL OR npshr_m >= 0),
    power_kw    NUMERIC CHECK (power_kw IS NULL OR power_kw >= 0)
);
CREATE INDEX pump_curve_points_pump ON pump_curve_points (pump_id, sort_order);

-- ---------- Recommended values (defaults users may override per project) ----------
CREATE TABLE recommended_values (
    key         TEXT PRIMARY KEY,
    value       NUMERIC NOT NULL,
    unit        TEXT NOT NULL DEFAULT '',
    label       TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  BIGINT REFERENCES users(id)
);

-- ---------- Projects (reserved — UI to be designed separately) ----------
CREATE TABLE projects (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE project_module_states (
    project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    module_id   TEXT NOT NULL,
    state       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, module_id)
);
