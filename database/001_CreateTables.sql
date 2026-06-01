-- ============================================================================
-- Post-on-Steroids: Database Schema
-- Engine: Microsoft SQL Server
-- Convention: Sequential GUID (NEWSEQUENTIALID) primary keys,
--             DateTime2 audit columns on every table.
-- ============================================================================

-- ─── 1. USER AUTH ───────────────────────────────────────────────────────────
CREATE TABLE [dbo].[UserAuth] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [Email]           NVARCHAR(320)     NOT NULL,
    [Otp]             NVARCHAR(10)      NULL,
    [IsAuthenticated] BIT               NOT NULL  DEFAULT 0,
    [OtpExpiresAt]    DATETIME2(7)      NULL,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_UserAuth]         PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_UserAuth_Email]   UNIQUE ([Email])
);
GO

-- ─── 2. CAPSULE (Collection / Project) ─────────────────────────────────────
CREATE TABLE [dbo].[Capsule] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [UserId]          UNIQUEIDENTIFIER  NOT NULL,
    [Name]            NVARCHAR(255)     NOT NULL,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_Capsule]           PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_Capsule_User]      FOREIGN KEY ([UserId]) REFERENCES [dbo].[UserAuth]([Id])
);
GO

-- ─── 3. REQUEST (Saved API request state) ──────────────────────────────────
CREATE TABLE [dbo].[Request] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [CapsuleId]       UNIQUEIDENTIFIER  NOT NULL,
    [UserId]          UNIQUEIDENTIFIER  NOT NULL,
    [Name]            NVARCHAR(255)     NOT NULL  DEFAULT N'New Request',
    [Url]             NVARCHAR(2048)    NOT NULL  DEFAULT N'',
    [Method]          NVARCHAR(10)      NOT NULL  DEFAULT N'GET',
    -- Payload
    [PayloadType]     NVARCHAR(20)      NOT NULL  DEFAULT N'params',
    [BodyType]        NVARCHAR(20)      NOT NULL  DEFAULT N'none',
    [RawType]         NVARCHAR(20)      NOT NULL  DEFAULT N'JSON',
    [RawBody]         NVARCHAR(MAX)     NULL,
    [RawBodyJson]     NVARCHAR(MAX)     NULL,
    [RawBodyXml]      NVARCHAR(MAX)     NULL,
    -- Auth
    [AuthType]        NVARCHAR(10)      NOT NULL  DEFAULT N'none',
    [AuthToken]       NVARCHAR(MAX)     NULL,
    -- Scripts
    [PreRequestScript]      NVARCHAR(MAX)  NULL,
    [PostResponseScript]    NVARCHAR(MAX)  NULL,
    -- Encryption
    [EncryptionAlgorithm]   NVARCHAR(20)   NOT NULL  DEFAULT N'none',
    [EncryptionKey]         NVARCHAR(MAX)  NULL,
    [AutoEncryptBody]       BIT            NOT NULL  DEFAULT 0,
    [AutoEncryptHeaders]    BIT            NOT NULL  DEFAULT 0,
    [EncryptionChannel]     NVARCHAR(255)  NULL,
    [EncryptedHeaders]      NVARCHAR(MAX)  NULL,      -- JSON array of keys
    [EncryptedBodyPaths]    NVARCHAR(MAX)  NULL,      -- JSON array of paths
    [EncryptionScript]      NVARCHAR(MAX)  NULL,
    -- Settings
    [FollowRedirects]       BIT            NOT NULL  DEFAULT 1,
    [VerifySsl]             BIT            NOT NULL  DEFAULT 1,
    [EnableCookies]         BIT            NOT NULL  DEFAULT 1,
    [BypassCors]            BIT            NOT NULL  DEFAULT 1,
    -- Audit
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_Request]           PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_Request_Capsule]   FOREIGN KEY ([CapsuleId]) REFERENCES [dbo].[Capsule]([Id]),
    CONSTRAINT [FK_Request_User]      FOREIGN KEY ([UserId])    REFERENCES [dbo].[UserAuth]([Id])
);
GO

-- ─── 4. REQUEST PARAMS ─────────────────────────────────────────────────────
CREATE TABLE [dbo].[RequestParam] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [RequestId]       UNIQUEIDENTIFIER  NOT NULL,
    [IsEnabled]       BIT               NOT NULL  DEFAULT 1,
    [ParamKey]        NVARCHAR(500)     NOT NULL  DEFAULT N'',
    [ParamValue]      NVARCHAR(MAX)     NOT NULL  DEFAULT N'',
    [SortOrder]       INT               NOT NULL  DEFAULT 0,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_RequestParam]          PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_RequestParam_Request]  FOREIGN KEY ([RequestId]) REFERENCES [dbo].[Request]([Id]) ON DELETE CASCADE
);
GO

-- ─── 5. REQUEST HEADERS ────────────────────────────────────────────────────
CREATE TABLE [dbo].[RequestHeader] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [RequestId]       UNIQUEIDENTIFIER  NOT NULL,
    [IsEnabled]       BIT               NOT NULL  DEFAULT 1,
    [HeaderKey]       NVARCHAR(500)     NOT NULL  DEFAULT N'',
    [HeaderValue]     NVARCHAR(MAX)     NOT NULL  DEFAULT N'',
    [SortOrder]       INT               NOT NULL  DEFAULT 0,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_RequestHeader]          PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_RequestHeader_Request]  FOREIGN KEY ([RequestId]) REFERENCES [dbo].[Request]([Id]) ON DELETE CASCADE
);
GO

-- ─── 6. REQUEST FORM DATA ──────────────────────────────────────────────────
CREATE TABLE [dbo].[RequestFormData] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [RequestId]       UNIQUEIDENTIFIER  NOT NULL,
    [IsEnabled]       BIT               NOT NULL  DEFAULT 1,
    [FieldKey]        NVARCHAR(500)     NOT NULL  DEFAULT N'',
    [FieldValue]      NVARCHAR(MAX)     NOT NULL  DEFAULT N'',
    [FieldType]       NVARCHAR(10)      NOT NULL  DEFAULT N'text',   -- 'text' | 'file'
    [SortOrder]       INT               NOT NULL  DEFAULT 0,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_RequestFormData]          PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_RequestFormData_Request]  FOREIGN KEY ([RequestId]) REFERENCES [dbo].[Request]([Id]) ON DELETE CASCADE
);
GO

-- ─── 7. GLOBAL VARIABLE ────────────────────────────────────────────────────
CREATE TABLE [dbo].[Variable] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [UserId]          UNIQUEIDENTIFIER  NOT NULL,
    [VariableKey]     NVARCHAR(255)     NOT NULL,
    [VariableValue]   NVARCHAR(MAX)     NOT NULL  DEFAULT N'',
    [IsEnabled]       BIT               NOT NULL  DEFAULT 1,
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_Variable]          PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_Variable_User]     FOREIGN KEY ([UserId]) REFERENCES [dbo].[UserAuth]([Id])
);
GO

-- ─── 8. REQUEST HISTORY ────────────────────────────────────────────────────
CREATE TABLE [dbo].[RequestHistory] (
    [Id]              UNIQUEIDENTIFIER  NOT NULL  DEFAULT NEWSEQUENTIALID(),
    [UserId]          UNIQUEIDENTIFIER  NOT NULL,
    [Method]          NVARCHAR(10)      NOT NULL,
    [Url]             NVARCHAR(2048)    NOT NULL,
    [RequestSnapshot] NVARCHAR(MAX)     NULL,      -- JSON snapshot of the full request state
    [ResponseStatus]  INT               NULL,
    [ResponseTime]    INT               NULL,       -- milliseconds
    [ResponseSize]    BIGINT            NULL,       -- bytes
    [CreatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    [UpdatedAt]       DATETIME2(7)      NOT NULL  DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_RequestHistory]        PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [FK_RequestHistory_User]   FOREIGN KEY ([UserId]) REFERENCES [dbo].[UserAuth]([Id])
);
GO
