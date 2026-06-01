-- ============================================================================
-- Post-on-Steroids: Request History Stored Procedures
-- ============================================================================

-- ─── CREATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHistory_Create]
    @UserId             UNIQUEIDENTIFIER,
    @Method             NVARCHAR(10),
    @Url                NVARCHAR(2048),
    @RequestSnapshot    NVARCHAR(MAX) = NULL,
    @ResponseStatus     INT = NULL,
    @ResponseTime       INT = NULL,
    @ResponseSize       BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWSEQUENTIALID();

    INSERT INTO [dbo].[RequestHistory] (
        [Id], [UserId], [Method], [Url], 
        [RequestSnapshot], [ResponseStatus], [ResponseTime], [ResponseSize]
    )
    VALUES (
        @NewId, @UserId, @Method, @Url, 
        @RequestSnapshot, @ResponseStatus, @ResponseTime, @ResponseSize
    );

    SELECT * FROM [dbo].[RequestHistory] WHERE [Id] = @NewId;
END
GO

-- ─── GET ALL BY USER ───────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHistory_GetAllByUser]
    @UserId         UNIQUEIDENTIFIER,
    @Limit          INT = 100
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Limit) * 
    FROM [dbo].[RequestHistory]
    WHERE [UserId] = @UserId
    ORDER BY [CreatedAt] DESC;
END
GO

-- ─── DELETE SPECIFIC ITEM ──────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHistory_Delete]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM [dbo].[RequestHistory] 
    WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO

-- ─── CLEAR ALL HISTORY FOR USER ────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequestHistory_Clear]
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM [dbo].[RequestHistory] 
    WHERE [UserId] = @UserId;
END
GO
