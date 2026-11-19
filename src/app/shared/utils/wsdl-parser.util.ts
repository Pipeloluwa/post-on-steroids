export interface WsdlParsedRequest {
    name: string;
    method: 'POST';
    url: string;
    headers: { enabled: boolean; key: string; value: string }[];
    params: { enabled: boolean; key: string; value: string }[];
    bodyType: 'raw';
    rawType: 'XML (SOAP)';
    rawBody: string;
    rawBodyJson: string;
    rawBodyXml: string;
    rawBodyText: string;
    formData: any[];
}

export interface WsdlParseResult {
    serviceName: string;
    targetNamespace: string;
    endpointUrl: string;
    requests: WsdlParsedRequest[];
}

const SOAP11_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12_ENV_NS = 'http://www.w3.org/2003/05/soap-envelope';
const SOAP11_BINDING_NS = 'http://schemas.xmlsoap.org/wsdl/soap/';
const SOAP12_BINDING_NS = 'http://schemas.xmlsoap.org/wsdl/soap12/';

function localName(node: Element | null | undefined): string {
    if (!node) return '';
    return (node.localName || node.nodeName.split(':').pop() || '').toLowerCase();
}

function stripPrefix(qname: string | null | undefined): string {
    if (!qname) return '';
    const idx = qname.indexOf(':');
    return idx === -1 ? qname : qname.slice(idx + 1);
}

function getDirectChildren(parent: Element | null | undefined, nameLower?: string): Element[] {
    if (!parent) return [];
    const out: Element[] = [];
    for (let i = 0; i < parent.children.length; i++) {
        const el = parent.children[i];
        if (!nameLower || localName(el) === nameLower) {
            out.push(el);
        }
    }
    return out;
}

function getAllElementsByLocalName(root: Document | Element, nameLower: string): Element[] {
    const out: Element[] = [];
    const walk = (el: Element) => {
        if (localName(el) === nameLower) out.push(el);
        for (let i = 0; i < el.children.length; i++) {
            walk(el.children[i]);
        }
    };
    const start = root instanceof Document ? root.documentElement : root;
    if (start) walk(start);
    return out;
}

function sampleValueForXsdType(typeName: string): string {
    const base = stripPrefix(typeName).toLowerCase();
    if (!base) return '?';
    if (['int', 'integer', 'long', 'short', 'byte', 'nonnegativeinteger', 'positiveinteger', 'unsignedint', 'unsignedlong'].includes(base)) {
        return '0';
    }
    if (['decimal', 'float', 'double'].includes(base)) {
        return '0.0';
    }
    if (base === 'boolean') {
        return 'false';
    }
    if (base === 'datetime') {
        return '2025-01-01T00:00:00Z';
    }
    if (base === 'date') {
        return '2025-01-01';
    }
    if (base === 'time') {
        return '00:00:00Z';
    }
    if (['base64binary', 'hexbinary'].includes(base)) {
        return 'cid:0';
    }
    if (['string', 'normalizedstring', 'token', 'anyuri'].includes(base)) {
        return '?';
    }
    return '?';
}

interface XsdRegistry {
    elements: Map<string, Element>;
    complexTypes: Map<string, Element>;
    simpleTypes: Map<string, Element>;
    targetNamespaces: Map<Element, string>;
}

function buildXsdRegistry(docs: Document[]): XsdRegistry {
    const registry: XsdRegistry = {
        elements: new Map(),
        complexTypes: new Map(),
        simpleTypes: new Map(),
        targetNamespaces: new Map()
    };

    for (const doc of docs) {
        const schemas = getAllElementsByLocalName(doc, 'schema');
        for (const schema of schemas) {
            const tns = schema.getAttribute('targetNamespace') || '';
            for (const child of getDirectChildren(schema)) {
                const ln = localName(child);
                const name = child.getAttribute('name');
                if (!name) continue;
                registry.targetNamespaces.set(child, tns);
                if (ln === 'element') {
                    registry.elements.set(name, child);
                } else if (ln === 'complextype') {
                    registry.complexTypes.set(name, child);
                } else if (ln === 'simpletype') {
                    registry.simpleTypes.set(name, child);
                }
            }
        }
    }

    return registry;
}

function getEnumSample(simpleTypeEl: Element): string | null {
    const enums = getAllElementsByLocalName(simpleTypeEl, 'enumeration');
    if (enums.length > 0) {
        const val = enums[0].getAttribute('value');
        if (val !== null) return val;
    }
    const restriction = getDirectChildren(simpleTypeEl, 'restriction')[0];
    const base = restriction?.getAttribute('base');
    return base ? sampleValueForXsdType(base) : null;
}

function renderChildParticleXml(
    elDecl: Element,
    registry: XsdRegistry,
    nsPrefix: string,
    indent: string,
    visitedTypes: Set<string>,
    depth: number
): string {
    const refName = stripPrefix(elDecl.getAttribute('ref'));
    if (refName && registry.elements.has(refName) && !visitedTypes.has(`el:${refName}`)) {
        const nextVisited = new Set(visitedTypes);
        nextVisited.add(`el:${refName}`);
        return renderChildParticleXml(registry.elements.get(refName)!, registry, nsPrefix, indent, nextVisited, depth);
    }

    const name = elDecl.getAttribute('name') || refName || 'Param';
    const tag = nsPrefix ? `${nsPrefix}:${name}` : name;

    if (depth > 5) {
        return `${indent}<${tag}>?</${tag}>`;
    }

    const typeAttr = elDecl.getAttribute('type');
    const inlineComplex = getDirectChildren(elDecl, 'complextype')[0];
    const inlineSimple = getDirectChildren(elDecl, 'simpletype')[0];

    if (inlineComplex) {
        const childrenXml = renderComplexTypeChildren(inlineComplex, registry, nsPrefix, indent + '  ', visitedTypes, depth + 1);
        if (!childrenXml) return `${indent}<${tag}/>`;
        return `${indent}<${tag}>\n${childrenXml}\n${indent}</${tag}>`;
    }

    if (inlineSimple) {
        const val = getEnumSample(inlineSimple) ?? '?';
        return `${indent}<${tag}>${val}</${tag}>`;
    }

    if (typeAttr) {
        const strippedType = stripPrefix(typeAttr);
        if (registry.complexTypes.has(strippedType) && !visitedTypes.has(`ct:${strippedType}`)) {
            const nextVisited = new Set(visitedTypes);
            nextVisited.add(`ct:${strippedType}`);
            const childrenXml = renderComplexTypeChildren(
                registry.complexTypes.get(strippedType)!,
                registry,
                nsPrefix,
                indent + '  ',
                nextVisited,
                depth + 1
            );
            if (!childrenXml) return `${indent}<${tag}/>`;
            return `${indent}<${tag}>\n${childrenXml}\n${indent}</${tag}>`;
        }
        if (registry.simpleTypes.has(strippedType)) {
            const val = getEnumSample(registry.simpleTypes.get(strippedType)!) ?? '?';
            return `${indent}<${tag}>${val}</${tag}>`;
        }
        return `${indent}<${tag}>${sampleValueForXsdType(strippedType)}</${tag}>`;
    }

    return `${indent}<${tag}>?</${tag}>`;
}

function renderComplexTypeChildren(
    complexEl: Element,
    registry: XsdRegistry,
    nsPrefix: string,
    indent: string,
    visitedTypes: Set<string>,
    depth: number
): string {
    const lines: string[] = [];

    // Handle complexContent/extension inheritance
    const complexContent = getDirectChildren(complexEl, 'complexcontent')[0];
    if (complexContent) {
        const extension = getDirectChildren(complexContent, 'extension')[0];
        if (extension) {
            const baseName = stripPrefix(extension.getAttribute('base'));
            if (baseName && registry.complexTypes.has(baseName) && !visitedTypes.has(`ct:${baseName}`)) {
                const nextVisited = new Set(visitedTypes);
                nextVisited.add(`ct:${baseName}`);
                const baseLines = renderComplexTypeChildren(
                    registry.complexTypes.get(baseName)!,
                    registry,
                    nsPrefix,
                    indent,
                    nextVisited,
                    depth
                );
                if (baseLines) lines.push(baseLines);
            }
            const extLines = renderContainerParticles(extension, registry, nsPrefix, indent, visitedTypes, depth);
            if (extLines) lines.push(extLines);
            return lines.join('\n');
        }
    }

    const directLines = renderContainerParticles(complexEl, registry, nsPrefix, indent, visitedTypes, depth);
    if (directLines) lines.push(directLines);
    return lines.join('\n');
}

function renderContainerParticles(
    container: Element,
    registry: XsdRegistry,
    nsPrefix: string,
    indent: string,
    visitedTypes: Set<string>,
    depth: number
): string {
    const lines: string[] = [];
    for (const child of getDirectChildren(container)) {
        const ln = localName(child);
        if (ln === 'sequence' || ln === 'all' || ln === 'choice') {
            for (const item of getDirectChildren(child)) {
                const itemLn = localName(item);
                if (itemLn === 'element') {
                    lines.push(renderChildParticleXml(item, registry, nsPrefix, indent, visitedTypes, depth));
                } else if (itemLn === 'sequence' || itemLn === 'all' || itemLn === 'choice') {
                    const nested = renderContainerParticles(item, registry, nsPrefix, indent, visitedTypes, depth);
                    if (nested) lines.push(nested);
                }
            }
        } else if (ln === 'element') {
            lines.push(renderChildParticleXml(child, registry, nsPrefix, indent, visitedTypes, depth));
        }
    }
    return lines.join('\n');
}

function buildSoapEnvelope(
    bodyInnerXml: string,
    targetNamespace: string,
    nsPrefix: string,
    isSoap12: boolean
): string {
    const envNs = isSoap12 ? SOAP12_ENV_NS : SOAP11_ENV_NS;
    const tnsDecl = targetNamespace ? ` xmlns:${nsPrefix}="${targetNamespace}"` : '';
    const indentedBody = bodyInnerXml
        .split('\n')
        .map(line => (line ? `    ${line}` : line))
        .join('\n');

    return [
        `<soapenv:Envelope xmlns:soapenv="${envNs}"${tnsDecl}>`,
        `  <soapenv:Header/>`,
        `  <soapenv:Body>`,
        indentedBody,
        `  </soapenv:Body>`,
        `</soapenv:Envelope>`
    ].join('\n');
}

function stripWsdlQuery(url: string): string {
    return url.replace(/\?(single)?wsdl$/i, '').trim();
}

/**
 * Extracts `<xsd:import schemaLocation="..."/>` and `<xsd:include schemaLocation="..."/>` URLs
 * from a WSDL document so callers can fetch external schemas before building sample requests.
 */
export function extractWsdlSchemaLocations(wsdlXml: string, baseUrl: string): string[] {
    if (!wsdlXml || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(wsdlXml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return [];

    const locations = new Set<string>();
    const candidates = [
        ...getAllElementsByLocalName(doc, 'import'),
        ...getAllElementsByLocalName(doc, 'include')
    ];

    for (const el of candidates) {
        const loc = el.getAttribute('schemaLocation') || el.getAttribute('location');
        if (!loc) continue;
        try {
            const resolved = new URL(loc, baseUrl).toString();
            locations.add(resolved);
        } catch {
            // Skip invalid relative URI
        }
    }

    return Array.from(locations);
}

/**
 * Checks whether a raw text payload looks like a WSDL/XML service definition.
 */
export function isWsdlXml(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const sample = text.slice(0, 3000);
    return /<\s*(?:[a-zA-Z0-9_-]+:)?definitions\b/i.test(sample)
        && (/schemas\.xmlsoap\.org\/wsdl/i.test(sample) || /www\.w3\.org\/ns\/wsdl/i.test(sample) || /<\s*(?:[a-zA-Z0-9_-]+:)?portType\b/i.test(text));
}

/**
 * Parses a WSDL XML string (plus any fetched XSD documents) into OnSteroid SOAP Request definitions.
 */
export function parseWsdlToRequests(
    wsdlXml: string,
    sourceUrl: string,
    xsdXmls: string[] = []
): WsdlParseResult {
    const fallbackUrl = stripWsdlQuery(sourceUrl);
    if (typeof DOMParser === 'undefined') {
        throw new Error('XML parser is unavailable in this environment.');
    }

    const parser = new DOMParser();
    const wsdlDoc = parser.parseFromString(wsdlXml, 'text/xml');
    if (wsdlDoc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('Failed to parse WSDL XML document.');
    }

    const root = wsdlDoc.documentElement;
    const targetNamespace = root.getAttribute('targetNamespace') || '';
    const nsPrefix = 'tns';

    const serviceEl = getDirectChildren(root, 'service')[0];
    let serviceName = serviceEl?.getAttribute('name') || root.getAttribute('name') || '';
    if (!serviceName) {
        try {
            const seg = new URL(fallbackUrl).pathname.split('/').filter(Boolean).pop() || 'SOAP Service';
            serviceName = seg.replace(/\.(asmx|svc|wsdl)$/i, '');
        } catch {
            serviceName = 'SOAP Service';
        }
    }

    // Parse external XSD documents + inline WSDL schemas
    const docs: Document[] = [wsdlDoc];
    for (const xsd of xsdXmls) {
        if (!xsd) continue;
        try {
            const xdoc = parser.parseFromString(xsd, 'text/xml');
            if (xdoc.getElementsByTagName('parsererror').length === 0) {
                docs.push(xdoc);
            }
        } catch {
            // Ignore malformed auxiliary schema
        }
    }
    const registry = buildXsdRegistry(docs);

    // Map messages: messageName -> parts[]
    const messagesMap = new Map<string, { name: string; element?: string; type?: string }[]>();
    for (const msgEl of getDirectChildren(root, 'message')) {
        const msgName = msgEl.getAttribute('name');
        if (!msgName) continue;
        const parts = getDirectChildren(msgEl, 'part').map(p => ({
            name: p.getAttribute('name') || 'param',
            element: stripPrefix(p.getAttribute('element')),
            type: stripPrefix(p.getAttribute('type'))
        }));
        messagesMap.set(msgName, parts);
    }

    // Map portType operations: `${portTypeName}:${opName}` -> inputMessageName
    const portTypeOps = new Map<string, string>();
    for (const ptEl of getDirectChildren(root, 'porttype')) {
        const ptName = ptEl.getAttribute('name') || '';
        for (const opEl of getDirectChildren(ptEl, 'operation')) {
            const opName = opEl.getAttribute('name');
            if (!opName) continue;
            const inputEl = getDirectChildren(opEl, 'input')[0];
            const msgRef = stripPrefix(inputEl?.getAttribute('message'));
            if (ptName) portTypeOps.set(`${ptName}:${opName}`, msgRef);
            if (!portTypeOps.has(opName)) portTypeOps.set(opName, msgRef);
        }
    }

    // Determine endpoint URL and SOAP 1.1 / 1.2 ports from <wsdl:service>
    interface BindingEndpointInfo {
        endpointUrl: string;
        isSoap12: boolean;
    }
    const bindingEndpoints = new Map<string, BindingEndpointInfo>();
    let defaultEndpointUrl = fallbackUrl;

    for (const portEl of getAllElementsByLocalName(root, 'port')) {
        const bindingName = stripPrefix(portEl.getAttribute('binding'));
        let addressEl: Element | undefined;
        let isSoap12 = false;
        for (const ch of getDirectChildren(portEl)) {
            if (localName(ch) === 'address') {
                const ns = ch.namespaceURI || '';
                if (ns === SOAP12_BINDING_NS || ch.nodeName.toLowerCase().includes('soap12')) {
                    isSoap12 = true;
                    addressEl = ch;
                    break;
                }
                if (ns === SOAP11_BINDING_NS || !addressEl) {
                    addressEl = ch;
                }
            }
        }
        const loc = addressEl?.getAttribute('location') || fallbackUrl;
        if (loc && defaultEndpointUrl === fallbackUrl) {
            defaultEndpointUrl = loc;
        }
        if (bindingName) {
            bindingEndpoints.set(bindingName, { endpointUrl: loc || fallbackUrl, isSoap12 });
        }
    }

    const requests: WsdlParsedRequest[] = [];
    const seenKeys = new Set<string>();

    // Walk bindings: prefer SOAP 1.1 if both SOAP 1.1 and 1.2 expose identical operations, else include unique ops
    const bindings = getDirectChildren(root, 'binding');
    // Sort SOAP 1.1 bindings before SOAP 1.2 so primary SOAP 1.1 actions match standard ASMX expectations first
    bindings.sort((a, b) => {
        const aIs12 = (a.getAttribute('name') || '').toLowerCase().includes('12') ? 1 : 0;
        const bIs12 = (b.getAttribute('name') || '').toLowerCase().includes('12') ? 1 : 0;
        return aIs12 - bIs12;
    });

    for (const bindingEl of bindings) {
        const bindingName = bindingEl.getAttribute('name') || '';
        const portTypeName = stripPrefix(bindingEl.getAttribute('type'));
        const epInfo = bindingEndpoints.get(bindingName);

        // Skip HTTP GET/POST ASMX bindings (only keep SOAP bindings)
        const hasHttpBinding = getDirectChildren(bindingEl).some(ch => {
            const ns = (ch.namespaceURI || '').toLowerCase();
            return localName(ch) === 'binding' && ns.includes('/wsdl/http');
        });
        if (hasHttpBinding) continue;

        const soapBindingEl = getDirectChildren(bindingEl).find(ch => localName(ch) === 'binding');
        const isSoap12 = epInfo?.isSoap12
            || (soapBindingEl?.namespaceURI === SOAP12_BINDING_NS)
            || (soapBindingEl?.nodeName.toLowerCase().includes('soap12') ?? false);
        const endpointUrl = epInfo?.endpointUrl || defaultEndpointUrl;

        for (const opEl of getDirectChildren(bindingEl, 'operation')) {
            const opName = opEl.getAttribute('name');
            if (!opName) continue;

            // Avoid duplicating exact same operation name across SOAP 1.1 and SOAP 1.2 bindings
            if (seenKeys.has(opName)) continue;
            seenKeys.add(opName);

            const soapOpEl = getDirectChildren(opEl, 'operation')[0];
            const soapAction = soapOpEl?.getAttribute('soapAction') ?? '';

            const inputMsgName = portTypeOps.get(`${portTypeName}:${opName}`) || portTypeOps.get(opName) || '';
            const parts = messagesMap.get(inputMsgName) || [];

            let bodyInnerXml = '';
            if (parts.length === 1 && parts[0].element && registry.elements.has(parts[0].element)) {
                const elDecl = registry.elements.get(parts[0].element)!;
                const elNs = registry.targetNamespaces.get(elDecl) || targetNamespace;
                bodyInnerXml = renderChildParticleXml(elDecl, registry, elNs ? nsPrefix : '', '', new Set(), 0);
            } else if (parts.length > 0) {
                const wrapperTag = targetNamespace ? `${nsPrefix}:${opName}` : opName;
                const partLines = parts.map(p => {
                    if (p.element && registry.elements.has(p.element)) {
                        return renderChildParticleXml(registry.elements.get(p.element)!, registry, targetNamespace ? nsPrefix : '', '  ', new Set(), 1);
                    }
                    if (p.type && registry.complexTypes.has(p.type)) {
                        const children = renderComplexTypeChildren(registry.complexTypes.get(p.type)!, registry, targetNamespace ? nsPrefix : '', '    ', new Set([`ct:${p.type}`]), 1);
                        const tag = targetNamespace ? `${nsPrefix}:${p.name}` : p.name;
                        return children ? `  <${tag}>\n${children}\n  </${tag}>` : `  <${tag}/>`;
                    }
                    const tag = targetNamespace ? `${nsPrefix}:${p.name}` : p.name;
                    return `  <${tag}>${sampleValueForXsdType(p.type || 'string')}</${tag}>`;
                });
                bodyInnerXml = `<${wrapperTag}>\n${partLines.join('\n')}\n</${wrapperTag}>`;
            } else {
                const wrapperTag = targetNamespace ? `${nsPrefix}:${opName}` : opName;
                bodyInnerXml = `<${wrapperTag}/>`;
            }

            const soapXml = buildSoapEnvelope(bodyInnerXml, targetNamespace, nsPrefix, isSoap12);

            const headers: { enabled: boolean; key: string; value: string }[] = [
                {
                    enabled: true,
                    key: 'Content-Type',
                    value: isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8'
                }
            ];
            if (!isSoap12) {
                headers.push({
                    enabled: true,
                    key: 'SOAPAction',
                    value: `"${soapAction}"`
                });
            }

            requests.push({
                name: opName,
                method: 'POST',
                url: endpointUrl,
                headers,
                params: [],
                bodyType: 'raw',
                rawType: 'XML (SOAP)',
                rawBody: soapXml,
                rawBodyJson: '',
                rawBodyXml: soapXml,
                rawBodyText: '',
                formData: []
            });
        }
    }

    // Fallback: if no bindings defined, build directly from <wsdl:portType>
    if (requests.length === 0) {
        for (const [key, msgName] of portTypeOps.entries()) {
            const opName = key.includes(':') ? key.split(':')[1] : key;
            if (seenKeys.has(opName)) continue;
            seenKeys.add(opName);
            const parts = messagesMap.get(msgName) || [];
            let bodyInnerXml = `<${targetNamespace ? `${nsPrefix}:` : ''}${opName}/>`;
            if (parts.length === 1 && parts[0].element && registry.elements.has(parts[0].element)) {
                bodyInnerXml = renderChildParticleXml(registry.elements.get(parts[0].element)!, registry, targetNamespace ? nsPrefix : '', '', new Set(), 0);
            }
            const soapXml = buildSoapEnvelope(bodyInnerXml, targetNamespace, nsPrefix, false);
            requests.push({
                name: opName,
                method: 'POST',
                url: defaultEndpointUrl,
                headers: [
                    { enabled: true, key: 'Content-Type', value: 'text/xml; charset=utf-8' },
                    { enabled: true, key: 'SOAPAction', value: `"${targetNamespace ? `${targetNamespace.replace(/\/$/, '')}/${opName}` : opName}"` }
                ],
                params: [],
                bodyType: 'raw',
                rawType: 'XML (SOAP)',
                rawBody: soapXml,
                rawBodyJson: '',
                rawBodyXml: soapXml,
                rawBodyText: '',
                formData: []
            });
        }
    }

    return {
        serviceName,
        targetNamespace,
        endpointUrl: defaultEndpointUrl,
        requests
    };
}

/**
 * Discovers WSDL URLs and fallback `?op=` operations from an ASMX / WCF `.svc` HTML service page.
 */
export function inspectAsmxOrSvcHtml(html: string, pageUrl: string): {
    wsdlUrls: string[];
    serviceName: string;
    operationNames: string[];
} {
    const wsdlUrls = new Set<string>();
    const operationNames = new Set<string>();

    // Look for links to ?WSDL / ?singleWsdl / .wsdl
    const hrefRegex = /href=["']([^"']*(?:\?(?:single)?wsdl|\.wsdl))["']/gi;
    let match: RegExpExecArray | null;
    while ((match = hrefRegex.exec(html)) !== null) {
        try {
            wsdlUrls.add(new URL(match[1], pageUrl).toString());
        } catch {
            // Ignore malformed URL
        }
    }

    // Look for ASMX ?op=OpName links
    const opRegex = /href=["'][^"']*\?op=([A-Za-z0-9_.-]+)["']/gi;
    while ((match = opRegex.exec(html)) !== null) {
        operationNames.add(match[1]);
    }

    // Extract title / heading for service name
    let serviceName = '';
    const headingMatch = html.match(/<p[^>]*class=["']?heading1["']?[^>]*>([^<]+)<\/p>/i)
        || html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
        || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (headingMatch) {
        serviceName = headingMatch[1].replace(/\s+Web\s+Service\s*$/i, '').trim();
    }
    if (!serviceName) {
        try {
            serviceName = new URL(pageUrl).pathname.split('/').filter(Boolean).pop()?.replace(/\.(asmx|svc)$/i, '') || 'SOAP Service';
        } catch {
            serviceName = 'SOAP Service';
        }
    }

    return {
        wsdlUrls: Array.from(wsdlUrls),
        serviceName,
        operationNames: Array.from(operationNames)
    };
}

/**
 * Fallback parser for ASMX operation detail HTML (`?op=OperationName`) when `?WSDL` is unavailable.
 */
export function parseAsmxOperationPageToRequest(
    opName: string,
    opHtml: string,
    serviceEndpointUrl: string,
    defaultNamespace = 'http://tempuri.org/'
): WsdlParsedRequest {
    const soapActionMatch = opHtml.match(/SOAPAction:\s*"([^"]*)"/i);
    const soapAction = soapActionMatch ? soapActionMatch[1] : `${defaultNamespace.replace(/\/$/, '')}/${opName}`;

    // Try extracting the preformatted SOAP 1.1 XML sample if present on the ASMX page
    let soapXml = '';
    const preMatch = opHtml.match(/&lt;\?xml[\s\S]*?&lt;\/soap:Envelope&gt;/i)
        || opHtml.match(/&lt;soap:Envelope[\s\S]*?&lt;\/soap:Envelope&gt;/i)
        || opHtml.match(/<soap:Envelope[\s\S]*?<\/soap:Envelope>/i);
    if (preMatch) {
        soapXml = preMatch[0]
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/<\?xml[^>]*\?>\s*/i, '')
            .trim();
    } else {
        // Fallback: scrape form input field names from ASMX test form
        const inputFields: string[] = [];
        const inputRegex = /<input[^>]+name=["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = inputRegex.exec(opHtml)) !== null) {
            if (m[1] && !m[1].startsWith('__') && m[1].toLowerCase() !== 'invoke') {
                inputFields.push(m[1]);
            }
        }
        const inner = inputFields.length > 0
            ? `<${opName} xmlns="${defaultNamespace}">\n${inputFields.map(f => `  <${f}>?</${f}>`).join('\n')}\n</${opName}>`
            : `<${opName} xmlns="${defaultNamespace}"/>`;
        soapXml = [
            `<soapenv:Envelope xmlns:soapenv="${SOAP11_ENV_NS}">`,
            `  <soapenv:Header/>`,
            `  <soapenv:Body>`,
            ...inner.split('\n').map(l => `    ${l}`),
            `  </soapenv:Body>`,
            `</soapenv:Envelope>`
        ].join('\n');
    }

    return {
        name: opName,
        method: 'POST',
        url: stripWsdlQuery(serviceEndpointUrl),
        headers: [
            { enabled: true, key: 'Content-Type', value: 'text/xml; charset=utf-8' },
            { enabled: true, key: 'SOAPAction', value: `"${soapAction}"` }
        ],
        params: [],
        bodyType: 'raw',
        rawType: 'XML (SOAP)',
        rawBody: soapXml,
        rawBodyJson: '',
        rawBodyXml: soapXml,
        rawBodyText: '',
        formData: []
    };
}
