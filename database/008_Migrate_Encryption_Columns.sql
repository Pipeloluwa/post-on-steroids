-- ============================================================================
-- Post-on-Steroids: Migration Script
-- Migrates an existing database to support the new field-level encryption model.
--
-- Changes:
--   [Request] table:
--     REMOVED : [AutoEncrypt]        BIT            (single flag replaced by two)
--     ADDED   : [AutoEncryptBody]    BIT NOT NULL DEFAULT 0
--     ADDED   : [AutoEncryptHeaders] BIT NOT NULL DEFAULT 0
--     ADDED   : [EncryptedHeaders]   NVARCHAR(MAX)  NULL  (JSON array of header keys)
--     ADDED   : [EncryptedBodyPaths] NVARCHAR(MAX)  NULL  (JSON array of JSON paths)
--     ADDED   : [EncryptionScript]   NVARCHAR(MAX)  NULL  (custom encryption script body)
--
-- Run this ONCE against an existing database before re-running 004_Request_Procedures.sql.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- ============================================================================

-- ─── 1. Add AutoEncryptBody (migrating the value from the old AutoEncrypt column) ─
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'AutoEncryptBody'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        ADD [AutoEncryptBody] BIT NOT NULL DEFAULT 0;

    -- Carry forward the old AutoEncrypt value if the column still exists
    IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
          AND name = N'AutoEncrypt'
    )
    BEGIN
        UPDATE [dbo].[Request]
            SET [AutoEncryptBody] = [AutoEncrypt];
    END
END
GO

-- ─── 2. Add AutoEncryptHeaders ───────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'AutoEncryptHeaders'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        ADD [AutoEncryptHeaders] BIT NOT NULL DEFAULT 0;
END
GO

-- ─── 3. Add EncryptedHeaders ─────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'EncryptedHeaders'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        ADD [EncryptedHeaders] NVARCHAR(MAX) NULL;  -- JSON array, e.g. ["Authorization","X-Api-Key"]
END
GO

-- ─── 4. Add EncryptedBodyPaths ───────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'EncryptedBodyPaths'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        ADD [EncryptedBodyPaths] NVARCHAR(MAX) NULL;  -- JSON array, e.g. ["user.password","payment.card"]
END
GO

-- ─── 5. Add EncryptionScript ─────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'EncryptionScript'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        ADD [EncryptionScript] NVARCHAR(MAX) NULL;
END
GO

-- ─── 6. Drop deprecated AutoEncrypt column (after data has been migrated) ────
--
--  NOTE: Only drop if the new columns already exist (safety check).
--        If any views or legacy SPs still reference [AutoEncrypt], drop/update
--        them first, then run this block.
--
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'AutoEncrypt'
)
AND EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'[dbo].[Request]')
      AND name = N'AutoEncryptBody'
)
BEGIN
    ALTER TABLE [dbo].[Request]
        DROP COLUMN [AutoEncrypt];
END
GO
