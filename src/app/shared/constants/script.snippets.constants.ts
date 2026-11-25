export type ScriptLanguage = 'javascript' | 'python';

export interface DefaultScriptEntry {
    name: string;
    code: string;
    pythonCode?: string;
}

export interface ScriptSnippet {
    id: string;
    name: string;
    description: string;
    code: string;
    pythonCode?: string;
}

export const DEFAULT_ENCRYPTION_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Encrypt',
        code: `// Top-level imports are supported (e.g. import CryptoJS from 'crypto-js';)
// Access request fields & encryption targets via st.* (e.g. st.headers, st.body, st.params, st.encryptedHeaders, st.encryptedBodyPaths)
`,
        pythonCode: `# Top-level imports are supported (e.g. import hashlib, json)
# Access request fields & encryption targets via st.* or snake_case helpers (e.g. headers, body, encrypted_body_paths)
`
    },
    {
        name: 'Encrypt (Base64 Sample)',
        code: `// Encode targeted headers and top-level body fields using Base64 via st.*
for (const h of st.headers || []) {
    if (h.enabled && (st.encryptedHeaders || []).includes(h.key)) {
        h.value = btoa(String(h.value ?? ''));
    }
}
if (st.body && typeof st.body === 'object' && !Array.isArray(st.body)) {
    for (const path of st.encryptedBodyPaths || []) {
        if (Object.prototype.hasOwnProperty.call(st.body, path) && typeof st.body[path] !== 'object') {
            st.body[path] = btoa(String(st.body[path] ?? ''));
        }
    }
}
return st.body;`,
        pythonCode: `import base64

# Encode targeted headers and top-level body fields using Base64 as a starter template
for h in headers or []:
    if h.get('enabled') and h.get('key') in (encrypted_headers or []):
        h['value'] = base64.b64encode(str(h.get('value', '')))
if isinstance(body, dict):
    for path in encrypted_body_paths or []:
        if path in body and not isinstance(body[path], (dict, list)):
            body[path] = base64.b64encode(str(body[path]))
return body`
    }
];

export const DEFAULT_DECRYPTION_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Decrypt',
        code: `// Top-level imports are supported (e.g. import CryptoJS from 'crypto-js';)
// Access payload & decryption targets via st.* (e.g. st.headers, st.body, st.params, st.encryptedHeaders, st.encryptedBodyPaths)
`,
        pythonCode: `# Top-level imports are supported (e.g. import base64, json)
# Access payload & decryption targets via st.* or snake_case helpers (e.g. headers, body, encrypted_body_paths)
`
    },
    {
        name: 'Decrypt (Base64 Sample)',
        code: `// Decode targeted Base64 headers and top-level body fields via st.*
for (const h of st.headers || []) {
    if (h.enabled && (st.encryptedHeaders || []).includes(h.key) && h.value) {
        try { h.value = atob(String(h.value)); } catch {}
    }
}
if (st.body && typeof st.body === 'object' && !Array.isArray(st.body)) {
    for (const path of st.encryptedBodyPaths || []) {
        if (typeof st.body[path] === 'string') {
            try { st.body[path] = atob(st.body[path]); } catch {}
        }
    }
}
return st.body;`,
        pythonCode: `import base64

# Decode targeted Base64 headers and top-level body fields as a starter template
for h in headers or []:
    if h.get('enabled') and h.get('key') in (encrypted_headers or []) and h.get('value'):
        try:
            h['value'] = base64.b64decode(str(h['value']))
        except Exception:
            pass
if isinstance(body, dict):
    for path in encrypted_body_paths or []:
        if isinstance(body.get(path), str):
            try:
                body[path] = base64.b64decode(body[path])
            except Exception:
                pass
return body`
    }
];

export const DEFAULT_PRE_REQUEST_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Pre-request',
        code: `// Top-level imports are supported (e.g. import CryptoJS from 'crypto-js';)
// Access request parameters & helpers directly via st.* (type "st." for autocomplete, e.g. st.headers, st.body, st.setHeader)
`,
        pythonCode: `# Top-level imports are supported (e.g. import uuid, time, json)
# Access request parameters & helpers directly via st.* or set_header/set_body_field/set_env
`
    },
    {
        name: 'Pre-request (Dynamic Headers & Params)',
        code: `// Inject correlation ID and timestamp directly into outgoing request headers & query params
const requestId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
st.setHeader('X-Correlation-ID', requestId);
st.setQuery('timestamp', String(Date.now()));
console.log('Prepared request with X-Correlation-ID:', requestId);`,
        pythonCode: `import uuid
import time

# Inject correlation ID and timestamp directly into outgoing request headers & query params
request_id = str(uuid.uuid4())
set_header('X-Correlation-ID', request_id)
set_query('timestamp', str(int(time.time() * 1000)))
print(f'Prepared request with X-Correlation-ID: {request_id}')`
    },
    {
        name: 'Pre-request (Fetch Token & Populate Request)',
        code: `// Fetch data dynamically before sending and link values straight into request headers/body/params
const authUrl = st.getEnv('authUrl') || '';
if (!authUrl) {
    console.log('Set env var "authUrl" to auto-fetch a token before sending.');
    return;
}
const res = await fetch(authUrl, { method: 'GET' });
const data = await res.json();
const token = data?.token || data?.access_token;
if (token) {
    st.setHeader('Authorization', 'Bearer ' + token);
    st.setBodyField('meta.sessionToken', token);
    st.setEnv('lastToken', token);
}`,
        pythonCode: `import requests

# Fetch data dynamically before sending and link values straight into request headers/body/params
auth_url = get_env('authUrl') or ''
if not auth_url:
    print('Set env var "authUrl" to auto-fetch a token before sending.')
    return
res = await requests.get(auth_url)
data = res.json()
token = data.get('token') or data.get('access_token')
if token:
    set_header('Authorization', f'Bearer {token}')
    set_body_field('meta.sessionToken', token)
    set_env('lastToken', token)`
    }
];

export const DEFAULT_POST_RESPONSE_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Post-response',
        code: `// Top-level imports are supported across all script types
// Access response & request parameters directly via st.* (type "st." for autocomplete, e.g. st.responseBody, st.linkResponseToRequest)
`,
        pythonCode: `# Top-level imports are supported across all script types
# Access response & request parameters directly via st.* or link_response_to_request / set_env
`
    },
    {
        name: 'Post-response (Link Response to Request Fields)',
        code: `// Extract fields from st.responseBody and link them directly into request params, headers, query, or body (across tabs too!)
if (st.responseBody && typeof st.responseBody === 'object') {
    const token = st.responseBody?.token || st.responseBody?.data?.token;
    if (token) {
        st.setHeader('X-Session-Token', token);
        st.setBodyField('token', token);
        st.setEnv('authToken', token);
        console.log('Linked response token to request header & body.');
    }
}`,
        pythonCode: `# Extract fields from response_body and link them directly into request params, headers, query, or body
if isinstance(response_body, dict):
    data = response_body.get('data') or {}
    token = response_body.get('token') or (data.get('token') if isinstance(data, dict) else None)
    if token:
        set_header('X-Session-Token', token)
        set_body_field('token', token)
        set_env('authToken', token)
        print('Linked response token to request header & body.')`
    }
];

export const DEFAULT_TEST_SCRIPTS: DefaultScriptEntry[] = [
    {
        name: 'Test',
        code: `// Top-level imports are supported (e.g. import Ajv from 'ajv';)
// Write test assertions via st.test(...) / st.expect(...) and inspect st.responseStatus / st.responseBody
`,
        pythonCode: `# Top-level imports are supported above
# Write assertions via st.test(...) or print PASS:/FAIL: checks using response_status / response_body
`
    },
    {
        name: 'Test (Status, Latency & Schema)',
        code: `st.test('Status code is 2xx', () => {
    st.expect(st.responseStatus).to.be.above(199);
    st.expect(st.responseStatus).to.be.below(300);
});
st.test('Response time < 2000ms', () => {
    st.expect(st.responseTime).to.be.below(2000);
});
st.test('Response body is present', () => {
    st.expect(st.responseBody).to.not.be.null;
});`,
        pythonCode: `if 200 <= (response_status or 0) < 300:
    print('PASS: Status code is 2xx')
else:
    print(f'FAIL: Expected 2xx status, got {response_status}')
if (response_time or 0) < 2000:
    print('PASS: Response time < 2000ms')
else:
    print(f'FAIL: Slow response {response_time}ms')
if response_body is not None:
    print('PASS: Response body is present')
else:
    print('FAIL: Response body is empty')`
    }
];

export const DEFAULT_ENCRYPTION_SCRIPT_SKELETON = DEFAULT_ENCRYPTION_SCRIPTS[0].code;
export const DEFAULT_DECRYPTION_SCRIPT_SKELETON = DEFAULT_DECRYPTION_SCRIPTS[0].code;
export const DEFAULT_PRE_REQUEST_SCRIPT_SKELETON = DEFAULT_PRE_REQUEST_SCRIPTS[0].code;
export const DEFAULT_POST_RESPONSE_SCRIPT_SKELETON = DEFAULT_POST_RESPONSE_SCRIPTS[0].code;
export const DEFAULT_TEST_SCRIPT_SKELETON = DEFAULT_TEST_SCRIPTS[0].code;

export function getDefaultScriptEntriesByType(type: string, name?: string): DefaultScriptEntry[] {
    if (type === 'Encryption') {
        const lowerName = (name || '').trim().toLowerCase();
        if (lowerName.includes('decrypt')) {
            return DEFAULT_DECRYPTION_SCRIPTS;
        }
        return [...DEFAULT_ENCRYPTION_SCRIPTS, ...DEFAULT_DECRYPTION_SCRIPTS];
    }
    if (type === 'PreRequest') return DEFAULT_PRE_REQUEST_SCRIPTS;
    if (type === 'PostRequest') return DEFAULT_POST_RESPONSE_SCRIPTS;
    if (type === 'Test') return DEFAULT_TEST_SCRIPTS;
    return [];
}

export function getDefaultScriptCode(type: string, name?: string, language: ScriptLanguage = 'javascript'): string {
    const entries = getDefaultScriptEntriesByType(type, name);
    if (entries.length === 0) return '';
    const lowerName = (name || '').trim().toLowerCase();
    const matched = (lowerName
        ? entries.find(e => e.name.trim().toLowerCase() === lowerName)
        : undefined) || entries[0];
    if (language === 'python' && matched.pythonCode) {
        return matched.pythonCode;
    }
    return matched.code;
}

export function getNewScriptGuidelineCode(type: string, language: ScriptLanguage = 'javascript'): string {
    if (language === 'python') {
        if (type === 'Encryption') {
            return `# New Encryption Script (Python)
# Top-level imports are supported (e.g. import base64, hashlib, json)
# Access request payload & encryption targets directly via st.* or snake_case variables
# Available: st.headers, st.body, st.params, st.encryptedHeaders, st.encryptedBodyPaths
`;
        }
        if (type === 'PostRequest') {
            return `# New Post-Response Script (Python)
# Top-level imports are supported (e.g. import json, re)
# Inspect st.response_body / st.response_headers and link values into current or other tabs:
# st.link_response_to_request("data.token", "header", "Authorization", st.response_body, "Target Request Name")
`;
        }
        if (type === 'Test') {
            return `# New Test Script (Python)
# Top-level imports are supported (e.g. import json)
# Assert status, headers, latency, or body via st.test(...) or PASS:/FAIL: logs
# Example: st.expect(st.response_status).to.equal(200)
`;
        }
        return `# New Pre-Request Script (Python)
# Top-level imports are supported (e.g. import uuid, time, json)
# Access & mutate outgoing request fields directly via st.* (e.g. st.set_header, st.set_body_field, st.set_env)
`;
    }

    if (type === 'Encryption') {
        return `// New Encryption Script (JavaScript)
// Top-level imports are supported (e.g. import CryptoJS from 'crypto-js';)
// Access request fields & encryption targets directly via st.* (type "st." for autocomplete)
// Available: st.headers, st.body, st.params, st.encryptedHeaders, st.encryptedBodyPaths
// Return modified payload if needed (e.g. return st.body;)
`;
    }
    if (type === 'PostRequest') {
        return `// New Post-Response Script (JavaScript)
// Top-level imports are supported (e.g. import Ajv from 'ajv';)
// Access response & helpers directly via st.* (type "st." for autocomplete)
// Example: st.linkResponseToRequest('data.token', 'header', 'Authorization', st.responseBody, 'Target Request');
`;
    }
    if (type === 'Test') {
        return `// New Test Script (JavaScript)
// Top-level imports are supported (e.g. import Ajv from 'ajv';)
// Write assertions directly using st.test(...) & st.expect(...) with st.responseStatus / st.responseBody
`;
    }
    return `// New Pre-Request Script (JavaScript)
// Top-level imports are supported (e.g. import CryptoJS from 'crypto-js';)
// Access & modify outgoing request fields directly via st.* (e.g. st.headers, st.body, st.setHeader, st.setEnv)
`;
}

export function isDefaultSkeletonCode(code: string): boolean {
    const trimmed = (code || '').trim();
    if (!trimmed) return true;
    const allEntries = [
        ...DEFAULT_ENCRYPTION_SCRIPTS,
        ...DEFAULT_DECRYPTION_SCRIPTS,
        ...DEFAULT_PRE_REQUEST_SCRIPTS,
        ...DEFAULT_POST_RESPONSE_SCRIPTS,
        ...DEFAULT_TEST_SCRIPTS
    ];
    if (allEntries.some(e => e.code.trim() === trimmed || (e.pythonCode && e.pythonCode.trim() === trimmed))) {
        return true;
    }
    // Also treat blank new-script guideline templates & legacy empty wrapper functions as default/blank skeletons
    const guidelineTypes = ['Encryption', 'PreRequest', 'PostRequest', 'Test'];
    return guidelineTypes.some(t =>
        getNewScriptGuidelineCode(t, 'javascript').trim() === trimmed ||
        getNewScriptGuidelineCode(t, 'python').trim() === trimmed
    );
}

export const PRE_REQUEST_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'log_timestamp',
        name: 'Log Request Timestamp',
        description: 'Log the current timestamp to the console',
        code: `console.log("Request started at: " + new Date().toISOString());`,
        pythonCode: `print("Request started at:", time.time())`
    },
    {
        id: 'add_custom_header',
        name: 'Add Custom Header',
        description: 'Add a custom header directly to the outgoing request',
        code: `// Add a custom header directly to request Headers
st.setHeader("X-Custom-Header", "MyCustomValue");`,
        pythonCode: `# Add a custom header directly to request Headers
set_header("X-Custom-Header", "MyCustomValue")`
    },
    {
        id: 'link_body_field',
        name: 'Set Request Body Field',
        description: 'Populate or update a field path inside the outgoing request body',
        code: `// Populate a field path inside request Body
st.setBodyField("meta.requestId", String(Date.now()));`,
        pythonCode: `# Populate a field path inside request Body
set_body_field("meta.requestId", str(int(time.time() * 1000)))`
    },
    {
        id: 'link_param_query',
        name: 'Set Request Param / Query',
        description: 'Populate a parameter in Params / URL query string',
        code: `// Populate request query/param directly
st.setParam("source", "pre-script");
st.setQuery("version", "2026-11");`,
        pythonCode: `# Populate request query/param directly
set_param("source", "pre-script")
set_query("version", "2026-11")`
    }
];

export const POST_RESPONSE_SNIPPETS: ScriptSnippet[] = [
    {
        id: 'check_200',
        name: 'Check 200 OK',
        description: 'Log if the response status is 200 OK',
        code: `if (st.responseStatus === 200) {
    console.log("Request was successful (200 OK)");
} else {
    console.log("Request failed or returned non-200 status");
}`,
        pythonCode: `if response_status == 200:
    print("Request was successful (200 OK)")
else:
    print("Request failed or returned non-200 status")`
    },
    {
        id: 'log_response_body',
        name: 'Log Response Body',
        description: 'Log the raw response body to the console',
        code: `console.log("Response Body: ", st.responseBody);`,
        pythonCode: `print("Response Body:", response_body)`
    },
    {
        id: 'link_response_to_body',
        name: 'Link Response -> Body Field',
        description: 'Extract a response property and populate a field in Request Body',
        code: `// Link responseBody.data.id directly into Request Body field "recordId"
st.linkResponseToRequest("data.id", "body", "recordId");`,
        pythonCode: `# Link response_body["data"]["id"] directly into Request Body field "recordId"
link_response_to_request("data.id", "body", "recordId")`
    },
    {
        id: 'link_response_to_header',
        name: 'Link Response -> Header / Query',
        description: 'Extract a token/value from response and populate a Request Header & Query param',
        code: `// Link responseBody.token directly into Request Header & Query
st.linkResponseToRequest("token", "header", "Authorization");
st.linkResponseToRequest("sessionId", "query", "session");`,
        pythonCode: `# Link response_body["token"] directly into Request Header & Query
link_response_to_request("token", "header", "Authorization")
link_response_to_request("sessionId", "query", "session")`
    }
];
