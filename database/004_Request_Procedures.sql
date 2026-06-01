-- ============================================================================
-- Post-on-Steroids: Request Stored Procedures
-- ============================================================================

-- ─── CREATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_Create]
    @CapsuleId              UNIQUEIDENTIFIER,
    @UserId                 UNIQUEIDENTIFIER,
    @Name                   NVARCHAR(255)       = N'New Request',
    @Url                    NVARCHAR(2048)      = N'',
    @Method                 NVARCHAR(10)        = N'GET',
    @PayloadType            NVARCHAR(20)        = N'params',
    @BodyType               NVARCHAR(20)        = N'none',
    @RawType                NVARCHAR(20)        = N'JSON',
    @RawBody                NVARCHAR(MAX)       = NULL,
    @RawBodyJson            NVARCHAR(MAX)       = NULL,
    @RawBodyXml             NVARCHAR(MAX)       = NULL,
    @AuthType               NVARCHAR(10)        = N'none',
    @AuthToken              NVARCHAR(MAX)       = NULL,
    @PreRequestScript       NVARCHAR(MAX)       = NULL,
    @PostResponseScript     NVARCHAR(MAX)       = NULL,
    @EncryptionAlgorithm    NVARCHAR(20)        = N'none',
    @EncryptionKey          NVARCHAR(MAX)       = NULL,
    @AutoEncryptBody        BIT                 = 0,
    @AutoEncryptHeaders     BIT                 = 0,
    @EncryptionChannel      NVARCHAR(255)       = NULL,
    @EncryptedHeaders       NVARCHAR(MAX)       = NULL,
    @EncryptedBodyPaths     NVARCHAR(MAX)       = NULL,
    @EncryptionScript       NVARCHAR(MAX)       = NULL,
    @FollowRedirects        BIT                 = 1,
    @VerifySsl              BIT                 = 1,
    @EnableCookies          BIT                 = 1,
    @BypassCors             BIT                 = 1
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWSEQUENTIALID();

    INSERT INTO [dbo].[Request] (
        [Id], [CapsuleId], [UserId], [Name], [Url], [Method],
        [PayloadType], [BodyType], [RawType], [RawBody], [RawBodyJson], [RawBodyXml],
        [AuthType], [AuthToken],
        [PreRequestScript], [PostResponseScript],
        [EncryptionAlgorithm], [EncryptionKey], [AutoEncryptBody], [AutoEncryptHeaders], [EncryptionChannel],
        [EncryptedHeaders], [EncryptedBodyPaths], [EncryptionScript],
        [FollowRedirects], [VerifySsl], [EnableCookies], [BypassCors]
    )
    VALUES (
        @NewId, @CapsuleId, @UserId, @Name, @Url, @Method,
        @PayloadType, @BodyType, @RawType, @RawBody, @RawBodyJson, @RawBodyXml,
        @AuthType, @AuthToken,
        @PreRequestScript, @PostResponseScript,
        @EncryptionAlgorithm, @EncryptionKey, @AutoEncryptBody, @AutoEncryptHeaders, @EncryptionChannel,
        @EncryptedHeaders, @EncryptedBodyPaths, @EncryptionScript,
        @FollowRedirects, @VerifySsl, @EnableCookies, @BypassCors
    );

    SELECT * FROM [dbo].[Request] WHERE [Id] = @NewId;
END
GO

-- ─── GET BY ID ─────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_GetById]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM [dbo].[Request]
    WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO

-- ─── GET ALL BY CAPSULE ────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_GetAllByCapsule]
    @CapsuleId      UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM [dbo].[Request]
    WHERE [CapsuleId] = @CapsuleId AND [UserId] = @UserId
    ORDER BY [CreatedAt] ASC;
END
GO

-- ─── UPDATE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_Update]
    @Id                     UNIQUEIDENTIFIER,
    @UserId                 UNIQUEIDENTIFIER,
    @Name                   NVARCHAR(255)       = NULL,
    @Url                    NVARCHAR(2048)      = NULL,
    @Method                 NVARCHAR(10)        = NULL,
    @PayloadType            NVARCHAR(20)        = NULL,
    @BodyType               NVARCHAR(20)        = NULL,
    @RawType                NVARCHAR(20)        = NULL,
    @RawBody                NVARCHAR(MAX)       = NULL,
    @RawBodyJson            NVARCHAR(MAX)       = NULL,
    @RawBodyXml             NVARCHAR(MAX)       = NULL,
    @AuthType               NVARCHAR(10)        = NULL,
    @AuthToken              NVARCHAR(MAX)       = NULL,
    @PreRequestScript       NVARCHAR(MAX)       = NULL,
    @PostResponseScript     NVARCHAR(MAX)       = NULL,
    @EncryptionAlgorithm    NVARCHAR(20)        = NULL,
    @EncryptionKey          NVARCHAR(MAX)       = NULL,
    @AutoEncryptBody        BIT                 = NULL,
    @AutoEncryptHeaders     BIT                 = NULL,
    @EncryptionChannel      NVARCHAR(255)       = NULL,
    @EncryptedHeaders       NVARCHAR(MAX)       = NULL,
    @EncryptedBodyPaths     NVARCHAR(MAX)       = NULL,
    @EncryptionScript       NVARCHAR(MAX)       = NULL,
    @FollowRedirects        BIT                 = NULL,
    @VerifySsl              BIT                 = NULL,
    @EnableCookies          BIT                 = NULL,
    @BypassCors             BIT                 = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE [dbo].[Request]
    SET [Name]                  = COALESCE(@Name,                [Name]),
        [Url]                   = COALESCE(@Url,                 [Url]),
        [Method]                = COALESCE(@Method,              [Method]),
        [PayloadType]           = COALESCE(@PayloadType,         [PayloadType]),
        [BodyType]              = COALESCE(@BodyType,            [BodyType]),
        [RawType]               = COALESCE(@RawType,             [RawType]),
        [RawBody]               = COALESCE(@RawBody,             [RawBody]),
        [RawBodyJson]           = COALESCE(@RawBodyJson,         [RawBodyJson]),
        [RawBodyXml]            = COALESCE(@RawBodyXml,          [RawBodyXml]),
        [AuthType]              = COALESCE(@AuthType,            [AuthType]),
        [AuthToken]             = COALESCE(@AuthToken,           [AuthToken]),
        [PreRequestScript]      = COALESCE(@PreRequestScript,    [PreRequestScript]),
        [PostResponseScript]    = COALESCE(@PostResponseScript,  [PostResponseScript]),
        [EncryptionAlgorithm]   = COALESCE(@EncryptionAlgorithm, [EncryptionAlgorithm]),
        [EncryptionKey]         = COALESCE(@EncryptionKey,       [EncryptionKey]),
        [AutoEncryptBody]       = COALESCE(@AutoEncryptBody,     [AutoEncryptBody]),
        [AutoEncryptHeaders]    = COALESCE(@AutoEncryptHeaders,  [AutoEncryptHeaders]),
        [EncryptionChannel]     = COALESCE(@EncryptionChannel,   [EncryptionChannel]),
        [EncryptedHeaders]      = COALESCE(@EncryptedHeaders,    [EncryptedHeaders]),
        [EncryptedBodyPaths]    = COALESCE(@EncryptedBodyPaths,  [EncryptedBodyPaths]),
        [EncryptionScript]      = COALESCE(@EncryptionScript,    [EncryptionScript]),
        [FollowRedirects]       = COALESCE(@FollowRedirects,     [FollowRedirects]),
        [VerifySsl]             = COALESCE(@VerifySsl,           [VerifySsl]),
        [EnableCookies]         = COALESCE(@EnableCookies,       [EnableCookies]),
        [BypassCors]            = COALESCE(@BypassCors,          [BypassCors]),
        [UpdatedAt]             = SYSUTCDATETIME()
    WHERE [Id] = @Id AND [UserId] = @UserId;

    SELECT * FROM [dbo].[Request] WHERE [Id] = @Id;
END
GO

-- ─── DELETE ────────────────────────────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_Delete]
    @Id             UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;

    -- Child rows (Params, Headers, FormData) cascade via FK
    DELETE FROM [dbo].[Request]
    WHERE [Id] = @Id AND [UserId] = @UserId;
END
GO

-- ─── DUPLICATE (Clone a request) ───────────────────────────────────────────
CREATE OR ALTER PROCEDURE [dbo].[spRequest_Duplicate]
    @SourceId       UNIQUEIDENTIFIER,
    @UserId         UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NewId UNIQUEIDENTIFIER = NEWSEQUENTIALID();

    BEGIN TRANSACTION;

    -- Clone the request
    INSERT INTO [dbo].[Request] (
        [Id], [CapsuleId], [UserId], [Name], [Url], [Method],
        [PayloadType], [BodyType], [RawType], [RawBody], [RawBodyJson], [RawBodyXml],
        [AuthType], [AuthToken],
        [PreRequestScript], [PostResponseScript],
        [EncryptionAlgorithm], [EncryptionKey], [AutoEncryptBody], [AutoEncryptHeaders], [EncryptionChannel],
        [EncryptedHeaders], [EncryptedBodyPaths], [EncryptionScript],
        [FollowRedirects], [VerifySsl], [EnableCookies], [BypassCors]
    )
    SELECT
        @NewId, [CapsuleId], [UserId], [Name] + N' (Copy)', [Url], [Method],
        [PayloadType], [BodyType], [RawType], [RawBody], [RawBodyJson], [RawBodyXml],
        [AuthType], [AuthToken],
        [PreRequestScript], [PostResponseScript],
        [EncryptionAlgorithm], [EncryptionKey], [AutoEncryptBody], [AutoEncryptHeaders], [EncryptionChannel],
        [EncryptedHeaders], [EncryptedBodyPaths], [EncryptionScript],
        [FollowRedirects], [VerifySsl], [EnableCookies], [BypassCors]
    FROM [dbo].[Request]
    WHERE [Id] = @SourceId AND [UserId] = @UserId;

    -- Clone params
    INSERT INTO [dbo].[RequestParam] ([RequestId], [IsEnabled], [ParamKey], [ParamValue], [SortOrder])
    SELECT @NewId, [IsEnabled], [ParamKey], [ParamValue], [SortOrder]
    FROM [dbo].[RequestParam]
    WHERE [RequestId] = @SourceId;

    -- Clone headers
    INSERT INTO [dbo].[RequestHeader] ([RequestId], [IsEnabled], [HeaderKey], [HeaderValue], [SortOrder])
    SELECT @NewId, [IsEnabled], [HeaderKey], [HeaderValue], [SortOrder]
    FROM [dbo].[RequestHeader]
    WHERE [RequestId] = @SourceId;

    -- Clone form data
    INSERT INTO [dbo].[RequestFormData] ([RequestId], [IsEnabled], [FieldKey], [FieldValue], [FieldType], [SortOrder])
    SELECT @NewId, [IsEnabled], [FieldKey], [FieldValue], [FieldType], [SortOrder]
    FROM [dbo].[RequestFormData]
    WHERE [RequestId] = @SourceId;

    COMMIT TRANSACTION;

    SELECT * FROM [dbo].[Request] WHERE [Id] = @NewId;
END
GO
