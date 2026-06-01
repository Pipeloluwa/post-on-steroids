-- ============================================================================
-- Post-on-Steroids: Request Child Tables Stored Procedures
-- (Params, Headers, FormData)
-- ============================================================================

-- ============================================================================
-- PARAMS
-- ============================================================================

-- ─── GET BY REQUEST ────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestParam_GetByRequest]
    @RequestId      UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [RequestId], [IsEnabled], [ParamKey], [ParamValue], [SortOrder], [CreatedAt], [UpdatedAt]
    FROM [dbo].[RequestParam]
    WHERE [RequestId] = @RequestId
    ORDER BY [SortOrder] ASC;
END
GO

-- ─── SYNC (Bulk replace) ───────────────────────────────────────────────────
-- Note: Uses JSON as input parameter for bulk operations
CREATE OR ALTER PROCEDURE [dbo].[spRequestParam_Sync]
    @RequestId      UNIQUEIDENTIFIER,
    @JsonData       NVARCHAR(MAX) -- format: [{"isEnabled": true, "key": "...", "value": "...", "sortOrder": 0}]
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    -- Remove existing
    DELETE FROM [dbo].[RequestParam] WHERE [RequestId] = @RequestId;

    -- Insert new
    IF @JsonData IS NOT NULL AND LTRIM(RTRIM(@JsonData)) <> '' AND @JsonData <> '[]'
    BEGIN
        INSERT INTO [dbo].[RequestParam] ([RequestId], [IsEnabled], [ParamKey], [ParamValue], [SortOrder])
        SELECT 
            @RequestId,
            JSON_VALUE(value, '$.isEnabled'),
            JSON_VALUE(value, '$.key'),
            JSON_VALUE(value, '$.value'),
            JSON_VALUE(value, '$.sortOrder')
        FROM OPENJSON(@JsonData);
    END

    COMMIT TRANSACTION;
    
    -- Return current state
    EXEC [dbo].[spRequestParam_GetByRequest] @RequestId = @RequestId;
END
GO

-- ============================================================================
-- HEADERS
-- ============================================================================

-- ─── GET BY REQUEST ────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHeader_GetByRequest]
    @RequestId      UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [RequestId], [IsEnabled], [HeaderKey], [HeaderValue], [SortOrder], [CreatedAt], [UpdatedAt]
    FROM [dbo].[RequestHeader]
    WHERE [RequestId] = @RequestId
    ORDER BY [SortOrder] ASC;
END
GO

-- ─── SYNC (Bulk replace) ───────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHeader_Sync]
    @RequestId      UNIQUEIDENTIFIER,
    @JsonData       NVARCHAR(MAX) -- format: [{"isEnabled": true, "key": "...", "value": "...", "sortOrder": 0}]
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DELETE FROM [dbo].[RequestHeader] WHERE [RequestId] = @RequestId;

    IF @JsonData IS NOT NULL AND LTRIM(RTRIM(@JsonData)) <> '' AND @JsonData <> '[]'
    BEGIN
        INSERT INTO [dbo].[RequestHeader] ([RequestId], [IsEnabled], [HeaderKey], [HeaderValue], [SortOrder])
        SELECT 
            @RequestId,
            JSON_VALUE(value, '$.isEnabled'),
            JSON_VALUE(value, '$.key'),
            JSON_VALUE(value, '$.value'),
            JSON_VALUE(value, '$.sortOrder')
        FROM OPENJSON(@JsonData);
    END

    COMMIT TRANSACTION;
    
    EXEC [dbo].[spRequestHeader_GetByRequest] @RequestId = @RequestId;
END
GO

-- ============================================================================
-- FORM DATA
-- ============================================================================

-- ─── GET BY REQUEST ────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestFormData_GetByRequest]
    @RequestId      UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [RequestId], [IsEnabled], [FieldKey], [FieldValue], [FieldType], [SortOrder], [CreatedAt], [UpdatedAt]
    FROM [dbo].[RequestFormData]
    WHERE [RequestId] = @RequestId
    ORDER BY [SortOrder] ASC;
END
GO

-- ─── SYNC (Bulk replace) ───────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestFormData_Sync]
    @RequestId      UNIQUEIDENTIFIER,
    @JsonData       NVARCHAR(MAX) -- format: [{"isEnabled": true, "key": "...", "value": "...", "type": "text", "sortOrder": 0}]
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    DELETE FROM [dbo].[RequestFormData] WHERE [RequestId] = @RequestId;

    IF @JsonData IS NOT NULL AND LTRIM(RTRIM(@JsonData)) <> '' AND @JsonData <> '[]'
    BEGIN
        INSERT INTO [dbo].[RequestFormData] ([RequestId], [IsEnabled], [FieldKey], [FieldValue], [FieldType], [SortOrder])
        SELECT 
            @RequestId,
            JSON_VALUE(value, '$.isEnabled'),
            JSON_VALUE(value, '$.key'),
            JSON_VALUE(value, '$.value'),
            COALESCE(JSON_VALUE(value, '$.type'), N'text'),
            JSON_VALUE(value, '$.sortOrder')
        FROM OPENJSON(@JsonData);
    END

    COMMIT TRANSACTION;
    
    EXEC [dbo].[spRequestFormData_GetByRequest] @RequestId = @RequestId;
END
GO
