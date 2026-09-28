-- ============================================================
-- Pretreatment equipment list (Pretreatment PRD v0.2 §1A):
-- vendor / consultant entries for MMF vessels, bag filters and cartridges.
-- Same life cycle as pumps: draft → approved (approver) → retired.
-- Category-specific data lives in `specs` (validated by the API).
-- ============================================================
CREATE TABLE equipment (
    id              BIGSERIAL PRIMARY KEY,
    category        TEXT NOT NULL CHECK (category IN ('mmf_vessel','bag_element','bag_housing','cartridge_element','cartridge_housing')),
    vendor          TEXT NOT NULL,
    model           TEXT NOT NULL,
    specs           JSONB NOT NULL DEFAULT '{}'::jsonb,
    datasheet_ref   TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    owner_id        BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    approved_by     BIGINT REFERENCES users(id)
);
CREATE INDEX equipment_cat_status ON equipment (category, status);
