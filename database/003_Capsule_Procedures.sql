-- ============================================================================
-- Post-on-Steroids: Capsule (Collection) Stored Procedures
-- ============================================================================

-- ─── CREATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spCapsule_Create]
    @UserId         UNIQUEIDENTIFIER,
    @Name           NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWSEQUENTIALID();

    INSERT INTO [dbo].[Capsule] ([Id], [UserId], [Name])
    VALUES (@NewId, @UserId, @Name);

    SELECT [Id], [UserId], [Name], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Capsule]
    WHERE [Id] = @NewId;
END
GO

-- ─── GET ALL BY USER ───────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spCapsule_GetAllByUser]
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [UserId], [Name], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Capsule]
    WHERE [UserId] = @UserId
    ORDER BY [CreatedAt] DESC;
END
GO

-- ─── GET BY ID ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spCapsule_GetById]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [UserId], [Name], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Capsule]
    WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO

-- ─── UPDATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spCapsule_Update]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER,
    @Name           NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE [dbo].[Capsule]
    SET [Name]      = @Name,
        [UpdatedAt] = SYSUTCDATETIME()
    WHERE [Id] = @Id AND [UserId] = @UserId;

    SELECT [Id], [UserId], [Name], [CreatedAt], [UpdatedAt]
    FROM [dbo].[Capsule]
    WHERE [Id] = @Id;
END
GO

-- ─── DELETE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spCapsule_Delete]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Cascade: delete requests (and their params/headers/formdata via FK cascades)
    DELETE FROM [dbo].[Request] WHERE [CapsuleId] = @Id AND [UserId] = @UserId;
    DELETE FROM [dbo].[Capsule] WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO
