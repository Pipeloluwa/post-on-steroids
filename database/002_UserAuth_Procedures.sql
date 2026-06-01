-- ============================================================================
-- Post-on-Steroids: UserAuth Stored Procedures
-- ============================================================================

-- ─── REGISTER (Create user) ────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_Register]
    @Email          NVARCHAR(320)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM [dbo].[UserAuth] WHERE [Email] = @Email)
    BEGIN
        -- Return existing user instead of erroring
        SELECT [Id], [Email], [Otp], [IsAuthenticated], [OtpExpiresAt], [CreatedAt], [UpdatedAt]
        FROM [dbo].[UserAuth]
        WHERE [Email] = @Email;
        RETURN;
    END

    INSERT INTO [dbo].[UserAuth] ([Email])
    VALUES (@Email);

    SELECT [Id], [Email], [Otp], [IsAuthenticated], [OtpExpiresAt], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Email] = @Email;
END
GO

-- ─── SEND OTP ──────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_SendOtp]
    @Email          NVARCHAR(320),
    @Otp            NVARCHAR(10),
    @OtpExpiresAt   DATETIME2(7)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM [dbo].[UserAuth] WHERE [Email] = @Email)
    BEGIN
        RAISERROR('User not found.', 16, 1);
        RETURN;
    END

    UPDATE [dbo].[UserAuth]
    SET [Otp]           = @Otp,
        [OtpExpiresAt]  = @OtpExpiresAt,
        [IsAuthenticated] = 0,
        [UpdatedAt]     = SYSUTCDATETIME()
    WHERE [Email] = @Email;

    SELECT [Id], [Email], [Otp], [IsAuthenticated], [OtpExpiresAt], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Email] = @Email;
END
GO

-- ─── VERIFY OTP (Authenticate) ─────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_VerifyOtp]
    @Email          NVARCHAR(320),
    @Otp            NVARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StoredOtp      NVARCHAR(10);
    DECLARE @OtpExpiresAt   DATETIME2(7);

    SELECT @StoredOtp = [Otp], @OtpExpiresAt = [OtpExpiresAt]
    FROM [dbo].[UserAuth]
    WHERE [Email] = @Email;

    IF @StoredOtp IS NULL
    BEGIN
        RAISERROR('User not found or OTP not generated.', 16, 1);
        RETURN;
    END

    IF @StoredOtp <> @Otp
    BEGIN
        RAISERROR('Invalid OTP.', 16, 1);
        RETURN;
    END

    IF @OtpExpiresAt < SYSUTCDATETIME()
    BEGIN
        RAISERROR('OTP has expired.', 16, 1);
        RETURN;
    END

    UPDATE [dbo].[UserAuth]
    SET [IsAuthenticated] = 1,
        [Otp]             = NULL,
        [OtpExpiresAt]    = NULL,
        [UpdatedAt]       = SYSUTCDATETIME()
    WHERE [Email] = @Email;

    SELECT [Id], [Email], [IsAuthenticated], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Email] = @Email;
END
GO

-- ─── GET BY EMAIL ──────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_GetByEmail]
    @Email          NVARCHAR(320)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [Email], [Otp], [IsAuthenticated], [OtpExpiresAt], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Email] = @Email;
END
GO

-- ─── GET BY ID ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_GetById]
    @Id             UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT [Id], [Email], [Otp], [IsAuthenticated], [OtpExpiresAt], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Id] = @Id;
END
GO

-- ─── UPDATE EMAIL ──────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_UpdateEmail]
    @Id             UNIQUEIDENTIFIER,
    @NewEmail       NVARCHAR(320)
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM [dbo].[UserAuth] WHERE [Email] = @NewEmail AND [Id] <> @Id)
    BEGIN
        RAISERROR('Email already in use by another account.', 16, 1);
        RETURN;
    END

    UPDATE [dbo].[UserAuth]
    SET [Email]     = @NewEmail,
        [UpdatedAt] = SYSUTCDATETIME()
    WHERE [Id] = @Id;

    SELECT [Id], [Email], [IsAuthenticated], [CreatedAt], [UpdatedAt]
    FROM [dbo].[UserAuth]
    WHERE [Id] = @Id;
END
GO

-- ─── LOGOUT ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_Logout]
    @Id             UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE [dbo].[UserAuth]
    SET [IsAuthenticated] = 0,
        [Otp]             = NULL,
        [OtpExpiresAt]    = NULL,
        [UpdatedAt]       = SYSUTCDATETIME()
    WHERE [Id] = @Id;
END
GO

-- ─── DELETE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spUserAuth_Delete]
    @Id             UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM [dbo].[UserAuth] WHERE [Id] = @Id;
END
GO
