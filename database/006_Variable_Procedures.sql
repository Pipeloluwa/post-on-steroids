-- ============================================================================
-- Post-on-Steroids: Global Variable Stored Procedures
-- ============================================================================

-- ─── CREATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spVariable_Create]
    @UserId         UNIQUEIDENTIFIER,
    @VariableKey    NVARCHAR(255),
    @VariableValue  NVARCHAR(MAX) = N'',
    @IsEnabled      BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWSEQUENTIALID();

    INSERT INTO [dbo].[Variable] ([Id], [UserId], [VariableKey], [VariableValue], [IsEnabled])
    VALUES (@NewId, @UserId, @VariableKey, @VariableValue, @IsEnabled);

    SELECT [Id], [UserId], [VariableKey], [VariableValue], [IsEnabled], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Variable]
    WHERE [Id] = @NewId;
END
GO

-- ─── GET ALL BY USER ───────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spVariable_GetAllByUser]
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [UserId], [VariableKey], [VariableValue], [IsEnabled], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Variable]
    WHERE [UserId] = @UserId
    ORDER BY [VariableKey] ASC;
END
GO

-- ─── UPDATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spVariable_Update]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER,
    @VariableKey    NVARCHAR(255) = NULL,
    @VariableValue  NVARCHAR(MAX) = NULL,
    @IsEnabled      BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE [dbo].[Variable]
    SET [VariableKey]   = COALESCE(@VariableKey, [VariableKey]),
        [VariableValue] = COALESCE(@VariableValue, [VariableValue]),
        [IsEnabled]     = COALESCE(@IsEnabled, [IsEnabled]),
        [UpdatedAt]     = SYSUTCDATETIME()
    WHERE [Id] = @Id AND [UserId] = @UserId;

    SELECT [Id], [UserId], [VariableKey], [VariableValue], [IsEnabled], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Variable]
    WHERE [Id] = @Id;
END
GO

-- ─── DELETE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spVariable_Delete]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM [dbo].[Variable] 
    WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO

-- ─── SYNC (Bulk Insert/Update/Delete) ──────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spVariable_Sync]
    @UserId         UNIQUEIDENTIFIER,
    @JsonData       NVARCHAR(MAX) -- format: [{"id": "...", "key": "...", "value": "...", "enabled": true}] (new items might not have id or have dummy id)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    -- Simplest approach for sync from a client: delete all and re-insert
    -- This assumes the client sends the complete list of variables.
    DELETE FROM [dbo].[Variable] WHERE [UserId] = @UserId;

    IF @JsonData IS NOT NULL AND LTRIM(RTRIM(@JsonData)) <> '' AND @JsonData <> '[]'
    BEGIN
        INSERT INTO [dbo].[Variable] ([Id], [UserId], [VariableKey], [VariableValue], [IsEnabled])
        SELECT 
            -- Try to use provided valid GUID, otherwise generate a new one
            COALESCE(
                TRY_CAST(JSON_VALUE(value, '$.id') AS UNIQUEIDENTIFIER),
                NEWSEQUENTIALID()
            ),
            @UserId,
            JSON_VALUE(value, '$.key'),
            COALESCE(JSON_VALUE(value, '$.value'), N''),
            COALESCE(JSON_VALUE(value, '$.enabled'), 1)
        FROM OPENJSON(@JsonData)
        WHERE JSON_VALUE(value, '$.key') IS NOT NULL AND LTRIM(RTRIM(JSON_VALUE(value, '$.key'))) <> '';
    END

    COMMIT TRANSACTION;

    EXEC [dbo].[spVariable_GetAllByUser] @UserId = @UserId;
END
GO
