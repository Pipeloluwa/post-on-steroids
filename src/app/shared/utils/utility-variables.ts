export const UTILITIES = [
    '$guid', '$timestamp', '$isoTimestamp', '$randomInt', '$randomUUID',
    '$randomEmail', '$randomName', '$randomFirstName', '$randomLastName', '$randomFullName',
    '$randomUserName', '$randomWord', '$randomColor', '$randomHexColor',
    '$randomCity', '$randomCountry', '$randomCountryCode', '$randomStreetAddress',
    '$randomPhoneNumber', '$randomBoolean', '$randomAlphaNumeric',
    '$randomIPv4', '$randomIPv6', '$randomMACAddress', '$randomUrl', '$randomDomainName',
    '$randomJobTitle', '$randomCompanyName', '$randomDepartment',
    '$randomPrice', '$randomCurrencyCode', '$randomFileName', '$randomMimeType',
    '$randomLoremWords', '$randomLoremSentence', '$randomLoremParagraph',
    '$randomDatePast', '$randomDateFuture'
] as const;

export const UTILITY_VARIABLE_NAMES = [
    'guid', 'timestamp', 'isoTimestamp', 'randomInt', 'randomUUID',
    'randomEmail', 'randomName', 'randomFirstName', 'randomLastName', 'randomFullName',
    'randomUserName', 'randomWord', 'randomColor', 'randomHexColor',
    'randomCity', 'randomCountry', 'randomCountryCode', 'randomStreetAddress',
    'randomPhoneNumber', 'randomBoolean', 'randomAlphaNumeric',
    'randomIPv4', 'randomIPv6', 'randomMACAddress', 'randomUrl', 'randomDomainName',
    'randomJobTitle', 'randomCompanyName', 'randomDepartment',
    'randomPrice', 'randomCurrencyCode', 'randomFileName', 'randomMimeType',
    'randomLoremWords', 'randomLoremSentence', 'randomLoremParagraph',
    'randomDatePast', 'randomDateFuture'
] as const;

const FIRST_NAMES = ['Ada', 'Liam', 'Amara', 'Noah', 'Zainab', 'Ethan', 'Chidi', 'Maya'];
const LAST_NAMES = ['Lovelace', 'Okafor', 'Patel', 'Mensah', 'Chen', 'Adebayo', 'Garcia', 'Kim'];
const CITIES = ['Lagos', 'New York', 'London', 'Nairobi', 'Toronto', 'Berlin', 'Tokyo', 'Accra'];
const COUNTRIES: Array<{ name: string; code: string }> = [
    { name: 'Nigeria', code: 'NG' },
    { name: 'United States', code: 'US' },
    { name: 'United Kingdom', code: 'GB' },
    { name: 'Germany', code: 'DE' },
    { name: 'Canada', code: 'CA' },
    { name: 'Japan', code: 'JP' }
];
const JOBS = ['Principal Engineer', 'Product Manager', 'API Architect', 'QA Lead', 'Solutions Designer'];
const COMPANIES = ['OnSteroid Labs', 'Northstar Systems', 'Apex FinTech', 'CloudBridge IO', 'Vanguard Data'];
const DEPARTMENTS = ['Engineering', 'Platform', 'Payments', 'Security', 'Operations'];
const CURRENCIES = ['USD', 'NGN', 'EUR', 'GBP', 'CAD', 'JPY'];
const WORDS = ['velocity', 'gateway', 'ledger', 'cipher', 'token', 'latency', 'payload', 'cluster'];
const MIME_TYPES = ['application/json', 'application/xml', 'text/plain', 'application/pdf', 'image/png'];

function pickRandom<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateUtilityValue(utility: string): string {
    const normalized = utility.startsWith('$') ? utility.toLowerCase() : `$${utility.toLowerCase()}`;
    switch (normalized) {
        case '$guid':
        case '$randomuuid': return crypto.randomUUID();
        case '$timestamp': return Date.now().toString();
        case '$isotimestamp': return new Date().toISOString();
        case '$randomint': return Math.floor(Math.random() * 1000).toString();
        case '$randomfirstname': return pickRandom(FIRST_NAMES);
        case '$randomlastname': return pickRandom(LAST_NAMES);
        case '$randomfullname':
        case '$randomname': return `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`;
        case '$randomusername': return `${pickRandom(FIRST_NAMES).toLowerCase()}_${Math.floor(Math.random() * 900 + 100)}`;
        case '$randomemail': return `${pickRandom(FIRST_NAMES).toLowerCase()}.${Math.floor(Math.random() * 10000)}@example.com`;
        case '$randomword': return pickRandom(WORDS);
        case '$randomcolor':
        case '$randomhexcolor': return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        case '$randomcity': return pickRandom(CITIES);
        case '$randomcountry': return pickRandom(COUNTRIES).name;
        case '$randomcountrycode': return pickRandom(COUNTRIES).code;
        case '$randomstreetaddress': return `${Math.floor(Math.random() * 900 + 10)} ${pickRandom(WORDS)} Street`;
        case '$randomphonenumber': return `+1-555-${Math.floor(1000 + Math.random() * 9000)}`;
        case '$randomboolean': return Math.random() > 0.5 ? 'true' : 'false';
        case '$randomalphanumeric': return Math.random().toString(36).substring(2, 10);
        case '$randomipv4': return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
        case '$randomipv6':
            return Array.from({ length: 8 }, () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0')).join(':');
        case '$randommacaddress':
            return Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':');
        case '$randomdomainname': return `${pickRandom(WORDS)}-${Math.floor(Math.random() * 99)}.example.com`;
        case '$randomurl': return `https://${pickRandom(WORDS)}.example.com/v1/items/${Math.floor(Math.random() * 999)}`;
        case '$randomjobtitle': return pickRandom(JOBS);
        case '$randomcompanyname': return pickRandom(COMPANIES);
        case '$randomdepartment': return pickRandom(DEPARTMENTS);
        case '$randomprice': return (Math.random() * 999 + 1).toFixed(2);
        case '$randomcurrencycode': return pickRandom(CURRENCIES);
        case '$randomfilename': return `${pickRandom(WORDS)}_${Math.floor(Math.random() * 100)}.json`;
        case '$randommimetype': return pickRandom(MIME_TYPES);
        case '$randomloremwords': return `${pickRandom(WORDS)} ${pickRandom(WORDS)} ${pickRandom(WORDS)}`;
        case '$randomloremsentence': return `Automated ${pickRandom(WORDS)} validation completed across ${pickRandom(WORDS)} node.`;
        case '$randomloremparagraph':
            return `Automated ${pickRandom(WORDS)} validation completed across ${pickRandom(WORDS)} node. Telemetry confirmed ${pickRandom(WORDS)} throughput.`;
        case '$randomdatepast':
            return new Date(Date.now() - Math.floor(Math.random() * 365 * 86400000)).toISOString();
        case '$randomdatefuture':
            return new Date(Date.now() + Math.floor(Math.random() * 365 * 86400000)).toISOString();
        default: return utility;
    }
}

export function getUtilityDescription(utility: string): string {
    const normalized = utility.startsWith('$') ? utility.toLowerCase() : `$${utility.toLowerCase()}`;
    switch (normalized) {
        case '$guid':
        case '$randomuuid': return 'Random UUID v4';
        case '$timestamp': return 'Current Unix timestamp (ms)';
        case '$isotimestamp': return 'Current ISO 8601 timestamp (UTC)';
        case '$randomint': return 'Random integer (0-999)';
        case '$randomemail': return 'Random email address';
        case '$randomfirstname': return 'Random first name';
        case '$randomlastname': return 'Random last name';
        case '$randomfullname':
        case '$randomname': return 'Random full name';
        case '$randomusername': return 'Random username';
        case '$randomword': return 'Random word';
        case '$randomcolor':
        case '$randomhexcolor': return 'Random hex color';
        case '$randomcity': return 'Random city name';
        case '$randomcountry': return 'Random country name';
        case '$randomcountrycode': return 'Random 2-letter ISO country code';
        case '$randomstreetaddress': return 'Random street address';
        case '$randomphonenumber': return 'Random phone number';
        case '$randomboolean': return 'Random boolean';
        case '$randomalphanumeric': return 'Random 8-char alphanumeric';
        case '$randomipv4': return 'Random IPv4 address';
        case '$randomipv6': return 'Random IPv6 address';
        case '$randommacaddress': return 'Random MAC address';
        case '$randomdomainname': return 'Random domain name';
        case '$randomurl': return 'Random HTTPS URL';
        case '$randomjobtitle': return 'Random job title';
        case '$randomcompanyname': return 'Random company name';
        case '$randomdepartment': return 'Random department';
        case '$randomprice': return 'Random monetary price';
        case '$randomcurrencycode': return 'Random ISO currency code';
        case '$randomfilename': return 'Random file name';
        case '$randommimetype': return 'Random MIME media type';
        case '$randomloremwords': return 'Three random words';
        case '$randomloremsentence': return 'Random sentence';
        case '$randomloremparagraph': return 'Random paragraph';
        case '$randomdatepast': return 'Random past ISO date';
        case '$randomdatefuture': return 'Random future ISO date';
        default: return 'Dynamic utility';
    }
}
