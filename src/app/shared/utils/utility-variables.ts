export const UTILITIES = [
    '$guid', '$timestamp', '$randomInt', '$randomUUID', 
    '$randomEmail', '$randomName', '$randomWord', '$randomColor', 
    '$randomCity', '$randomStreetAddress', '$randomPhoneNumber',
    '$randomBoolean', '$randomAlphaNumeric', '$randomIPv4'
] as const;

export const UTILITY_VARIABLE_NAMES = [
    'guid', 'timestamp', 'randomInt', 'randomUUID', 
    'randomEmail', 'randomName', 'randomWord', 'randomColor', 
    'randomCity', 'randomStreetAddress', 'randomPhoneNumber',
    'randomBoolean', 'randomAlphaNumeric', 'randomIPv4'
] as const;

export function generateUtilityValue(utility: string): string {
    const normalized = utility.startsWith('$') ? utility.toLowerCase() : `$${utility.toLowerCase()}`;
    switch (normalized) {
        case '$guid':
        case '$randomuuid': return crypto.randomUUID();
        case '$timestamp': return Date.now().toString();
        case '$randomint': return Math.floor(Math.random() * 1000).toString();
        case '$randomemail': return `test_${Math.floor(Math.random() * 10000)}@example.com`;
        case '$randomname': return 'John Doe';
        case '$randomword': return 'lorem';
        case '$randomcolor': return '#' + Math.floor(Math.random() * 16777215).toString(16);
        case '$randomcity': return 'New York';
        case '$randomstreetaddress': return '123 Main St';
        case '$randomphonenumber': return '555-0100';
        case '$randomboolean': return Math.random() > 0.5 ? 'true' : 'false';
        case '$randomalphanumeric': return Math.random().toString(36).substring(2, 10);
        case '$randomipv4': return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
        default: return utility;
    }
}

export function getUtilityDescription(utility: string): string {
    const normalized = utility.startsWith('$') ? utility.toLowerCase() : `$${utility.toLowerCase()}`;
    switch (normalized) {
        case '$guid':
        case '$randomuuid': return 'Random UUID v4';
        case '$timestamp': return 'Current Unix timestamp (ms)';
        case '$randomint': return 'Random integer (0-999)';
        case '$randomemail': return 'Random email address';
        case '$randomname': return 'Random full name';
        case '$randomword': return 'Random word';
        case '$randomcolor': return 'Random hex color';
        case '$randomcity': return 'Random city name';
        case '$randomstreetaddress': return 'Random street address';
        case '$randomphonenumber': return 'Random phone number';
        case '$randomboolean': return 'Random boolean';
        case '$randomalphanumeric': return 'Random 8-char alphanumeric';
        case '$randomipv4': return 'Random IPv4 address';
        default: return 'Dynamic utility';
    }
}
