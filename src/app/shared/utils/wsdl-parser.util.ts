import { formatXmlPretty } from './format.utils';

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
const HTTP_BINDING_NS = 'http://schemas.xmlsoap.org/wsdl/http/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

const STRING_DATA_TYPES = new Set<string>([
    'string',
    'normalizedstring',
    'token',
    'language',
    'name',
    'ncname',
    'nmtoken',
    'nmtokens',
    'id',
    'idref',
    'idrefs',
    'entity',
    'entities',
    'anyuri',
    'qname',
    'notation',
    'anytype',
    'anysimpletype',
    'char',
    'guid',
    'duration'
]);

function isStringXsdType(dataType: string): boolean {
    if (!dataType) return true;
    const lower = dataType.toLowerCase();
    return STRING_DATA_TYPES.has(lower) || lower.startsWith('unknown');
}

function getLocalName(node: Node): string {
    return (node as Element).localName || node.nodeName.split(':').pop() || '';
}

function getDirectElementChildren(parent: Element | Document, matchLocalName?: string): Element[] {
    const out: Element[] = [];
    const target = matchLocalName?.toLowerCase();
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        if (ch.nodeType === 1) {
            const el = ch as Element;
            if (!target || getLocalName(el).toLowerCase() === target) {
                out.push(el);
            }
        }
    }
    return out;
}

function getAllElementsByLocalName(root: Document | Element, matchLocalName: string): Element[] {
    const out: Element[] = [];
    const target = matchLocalName.toLowerCase();
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
        if (getLocalName(all[i]).toLowerCase() === target) {
            out.push(all[i]);
        }
    }
    return out;
}

function findClosestAncestorWithAttr(node: Node | null, attrName: string): Element | null {
    let curr: Node | null = node;
    while (curr && curr.nodeType === 1) {
        const el = curr as Element;
        if (el.hasAttribute(attrName)) {
            return el;
        }
        curr = curr.parentNode;
    }
    return null;
}

function findClosestSchemaElement(node: Node | null): Element | null {
    let curr: Node | null = node;
    while (curr && curr.nodeType === 1) {
        const el = curr as Element;
        if (getLocalName(el).toLowerCase() === 'schema') {
            return el;
        }
        curr = curr.parentNode;
    }
    return null;
}

/**
 * Wizdler-compatible XmlQualifiedName that resolves prefixes via DOM `lookupNamespaceURI`,
 * ancestor `xmlns:prefix` declarations, and global WSDL/XSD prefix tables.
 */
export class XmlQualifiedName {
    readonly ns: string;
    readonly localName: string;
    readonly full: string;

    constructor(ns: string | null | undefined, localName: string | null | undefined) {
        this.ns = ns || '';
        this.localName = localName || '';
        this.full = `${this.ns}:${this.localName}`;
    }

    static resolveNS(
        node: Element,
        name: string,
        fallbackPrefixMap?: Map<string, string>
    ): XmlQualifiedName {
        const parts = (name || '').trim().split(':');
        if (parts.length > 2) {
            throw new Error(`Invalid qualified name: ${name}`);
        }
        const hasPrefix = parts.length === 2;
        const prefix = hasPrefix ? parts[0] : null;
        const local = hasPrefix ? parts[1] : parts[0];

        let ns: string | null = null;
        if (hasPrefix && prefix) {
            if (typeof node.lookupNamespaceURI === 'function') {
                ns = node.lookupNamespaceURI(prefix);
            }
            if (!ns) {
                let curr: Node | null = node;
                while (curr && curr.nodeType === 1) {
                    const attrVal = (curr as Element).getAttribute(`xmlns:${prefix}`);
                    if (attrVal) {
                        ns = attrVal;
                        break;
                    }
                    curr = curr.parentNode;
                }
            }
            if (!ns && fallbackPrefixMap?.has(prefix)) {
                ns = fallbackPrefixMap.get(prefix) || null;
            }
        } else {
            const targetNsEl = findClosestAncestorWithAttr(node, 'targetNamespace');
            if (targetNsEl) {
                ns = targetNsEl.getAttribute('targetNamespace');
            } else if (typeof node.lookupNamespaceURI === 'function') {
                ns = node.lookupNamespaceURI(null);
            }
        }

        return new XmlQualifiedName(ns || '', local);
    }

    static fromElement(
        el: Element,
        name: string,
        fallbackPrefixMap?: Map<string, string>
    ): XmlQualifiedName {
        if (!el) throw new Error('Missing element for XmlQualifiedName.fromElement.');
        if (!name) throw new Error('Missing name for XmlQualifiedName.fromElement.');
        return XmlQualifiedName.resolveNS(el, name, fallbackPrefixMap);
    }
}

interface ValueGenerator {
    dataType: string;
    isStringType: boolean;
    generateValue: () => string;
}

class XmlValueGenerator {
    static readonly anyGenerator: ValueGenerator = {
        dataType: 'anyType',
        isStringType: true,
        generateValue: () => '[anyType]'
    };

    static readonly anySimpleGenerator: ValueGenerator = {
        dataType: 'anySimpleType',
        isStringType: true,
        generateValue: () => '[anySimpleType]'
    };

    static createGenerator(dataType: string, _listLength: number, minOccurs: number): ValueGenerator {
        const cleanType = dataType || 'anyType';
        const isStringType = isStringXsdType(cleanType);
        return {
            dataType: cleanType,
            isStringType,
            generateValue: () => `[${cleanType}${minOccurs === 0 ? '?' : ''}]`
        };
    }
}

class InstanceObject {
    minOccurs = 1;
    maxOccurs = 1;
    qname: XmlQualifiedName | null = null;
}

class InstanceAttribute extends InstanceObject {
    valueGenerator: ValueGenerator | null = null;
    fixedValue: string | null = null;
    defaultValue: string | null = null;
    nextAttribute: InstanceAttribute | null = null;

    genValue(): string {
        if (this.fixedValue != null) return this.fixedValue;
        if (this.defaultValue != null) return this.defaultValue;
        if (this.valueGenerator) return this.valueGenerator.generateValue();
        return '';
    }
}

class InstanceGroup extends InstanceObject {
    isChoice = false;
    parent: InstanceGroup | null = null;
    sibling: InstanceGroup | null = null;
    child: InstanceGroup | null = null;

    addChild(obj: InstanceGroup): void {
        obj.parent = this;
        if (!this.child) {
            this.child = obj;
        } else {
            let prev: InstanceGroup | null = null;
            let next: InstanceGroup | null = this.child;
            while (next) {
                prev = next;
                next = next.sibling;
            }
            if (prev) {
                prev.sibling = obj;
            }
        }
    }

    getChildGroup(index: number): InstanceGroup | null {
        let curIndex = 0;
        let currentGroup = this.child;
        while (currentGroup) {
            if (curIndex === index) {
                return currentGroup;
            }
            curIndex++;
            currentGroup = currentGroup.sibling;
        }
        return null;
    }

    getNumberOfChildren(): number {
        let numChildren = 0;
        let currentGroup = this.child;
        while (currentGroup) {
            numChildren++;
            currentGroup = currentGroup.sibling;
        }
        return numChildren;
    }
}

class InstanceElement extends InstanceGroup {
    isMixed = false;
    isNillable = false;
    genNil = true;
    xsiNil = false;
    firstAttribute: InstanceAttribute | null = null;
    comment = '';
    valueGenerator: ValueGenerator | null = null;
    fixedValue: string | null = null;
    defaultValue: string | null = null;
    isStringType = false;
    fromNamedComplexType = false;

    addAttribute(attr: InstanceAttribute): void {
        if (!this.firstAttribute) {
            this.firstAttribute = attr;
        } else {
            let curr = this.firstAttribute;
            while (curr.nextAttribute) {
                curr = curr.nextAttribute;
            }
            curr.nextAttribute = attr;
        }
    }

    clone(occurs: number): InstanceElement {
        const newElem = Object.assign(new InstanceElement(), this);
        newElem.maxOccurs = occurs;
        newElem.minOccurs = occurs;
        newElem.parent = null;
        newElem.sibling = null;
        return newElem;
    }

    genValue(): string {
        if (this.fixedValue != null) return this.fixedValue;
        if (this.defaultValue != null) return this.defaultValue;
        if (this.valueGenerator) return this.valueGenerator.generateValue();
        return '';
    }
}

/**
 * Port of Wizdler's `XmlSampleGenerator` (`xmlSampleGenerator.js`) with support for
 * multi-schema resolution and optional `<![CDATA[...]]>` wrapping on string leaf elements.
 */
export class XmlSampleGenerator {
    private readonly schemas: Element[];
    private readonly prefixMap: Map<string, string>;
    private readonly globalElements: Record<string, Element> = {};
    private readonly globalElementsByLocal: Record<string, Element> = {};
    private readonly globalTypes: Record<string, Element> = {};
    private readonly globalTypesByLocal: Record<string, Element> = {};
    private readonly globalGroups: Record<string, Element> = {};
    private readonly globalGroupsByLocal: Record<string, Element> = {};
    private readonly elementTypesProcessed: Element[] = [];
    private readonly listLength = 3;

    constructor(schemas: Element[], prefixMap: Map<string, string>) {
        if (!schemas) {
            throw new Error('Schemas failed to load. Cannot generate sample XML.');
        }
        this.schemas = schemas;
        this.prefixMap = prefixMap;
        this.initGlobalElements();
        this.initGlobalTypes();
        this.initGlobalGroups();
    }

    writeXml(rootName: XmlQualifiedName, useCdataForStrings = false): Element | null {
        this.elementTypesProcessed.length = 0;
        const schemaEl = this.globalElements[rootName.full] || this.globalElementsByLocal[rootName.localName];
        if (!schemaEl) {
            return null;
        }
        const root = this.generateElement(schemaEl);
        if (!root) {
            return null;
        }

        const ownerDoc = schemaEl.ownerDocument;
        const impl = ownerDoc?.implementation || (typeof document !== 'undefined' ? document.implementation : null);
        if (!impl) return null;

        // Only wrap in CDATA when the SOAP Body represents a raw body string (not a class-based complexType model)
        const allowCdata = useCdataForStrings && this.isRawBodyStringElement(root);

        const doc = impl.createDocument(root.qname?.ns || '', root.qname?.localName || 'root', null);
        const el = doc.documentElement;
        this.processElementAttrs(doc, root, el);
        this.processGroup(doc, root, el, allowCdata);
        this.processElementValue(doc, root, el, allowCdata);
        return el;
    }

    /**
     * Generates an XML element for a `<wsdl:part name="..." type="..."/>` message part
     * (used in RPC style or type-based Document style operations).
     */
    writeTypedElement(
        partName: string,
        partNamespace: string | null,
        typeQName: XmlQualifiedName,
        useCdataForStrings = false
    ): Element | null {
        this.elementTypesProcessed.length = 0;
        const elem = new InstanceElement();
        elem.qname = new XmlQualifiedName(partNamespace || '', partName);

        const typeEl = this.globalTypes[typeQName.full] || this.globalTypesByLocal[typeQName.localName] || null;
        if (typeEl && getLocalName(typeEl) === 'complexType') {
            elem.fromNamedComplexType = true;
            this.elementTypesProcessed.push(typeEl);
            this.processComplexType(typeEl, elem);
            this.elementTypesProcessed.pop();
        } else if (typeEl && getLocalName(typeEl) === 'simpleType') {
            const dt = this.getSimpleDataType(typeEl, typeEl);
            elem.valueGenerator = XmlValueGenerator.createGenerator(dt, this.listLength, 1);
            elem.isStringType = isStringXsdType(dt);
        } else {
            const dt = typeQName.localName || 'string';
            elem.valueGenerator = XmlValueGenerator.createGenerator(dt, this.listLength, 1);
            elem.isStringType = isStringXsdType(dt);
        }

        const refDoc = this.schemas[0]?.ownerDocument;
        const impl = refDoc?.implementation || (typeof document !== 'undefined' ? document.implementation : null);
        if (!impl) return null;

        const allowCdata = useCdataForStrings && !elem.fromNamedComplexType && !elem.child && elem.isStringType;

        const doc = impl.createDocument(elem.qname.ns || '\0', elem.qname.localName, null);
        const el = doc.documentElement;
        this.processElementAttrs(doc, elem, el);
        this.processGroup(doc, elem, el, allowCdata);
        this.processElementValue(doc, elem, el, allowCdata);
        return el;
    }

    private isRawBodyStringElement(root: InstanceElement): boolean {
        if (root.fromNamedComplexType) {
            return false;
        }
        // Direct simple string element (e.g. <RequestXml><![CDATA[[string]]]></RequestXml>)
        if (!root.child) {
            return root.isStringType;
        }
        // Operation wrapper element containing a single direct simple string parameter (not a class DTO)
        const directElements = this.collectChildInstanceElements(root);
        if (directElements.length === 1) {
            const single = directElements[0];
            return !single.fromNamedComplexType && !single.child && single.isStringType;
        }
        return false;
    }

    private collectChildInstanceElements(grp: InstanceGroup): InstanceElement[] {
        const result: InstanceElement[] = [];
        const count = grp.getNumberOfChildren();
        for (let i = 0; i < count; i++) {
            const ch = grp.getChildGroup(i);
            if (!ch) continue;
            if (ch instanceof InstanceElement) {
                result.push(ch);
            } else {
                result.push(...this.collectChildInstanceElements(ch));
            }
        }
        return result;
    }

    private processElementAttrs(_doc: Document, elem: InstanceElement, el: Element): void {
        if (elem.xsiNil) {
            el.setAttributeNS(XSI_NS, 'nil', 'true');
            return;
        }
        let attr = elem.firstAttribute;
        while (attr) {
            if (attr.qname?.localName) {
                el.setAttribute(attr.qname.localName, attr.genValue());
            }
            attr = attr.nextAttribute;
        }
    }

    private processElement(doc: Document, elem: InstanceElement, parentEl: Element, useCdataForStrings: boolean): void {
        const el = doc.createElementNS(elem.qname?.ns || '\0', elem.qname?.localName || 'item');
        parentEl.appendChild(el);
        this.processElementAttrs(doc, elem, el);
        if (!elem.xsiNil) {
            this.processGroup(doc, elem, el, useCdataForStrings);
            this.processElementValue(doc, elem, el, useCdataForStrings);
        }
    }

    private processGroup(doc: Document, grp: InstanceGroup, el: Element, useCdataForStrings: boolean): void {
        if (grp instanceof InstanceElement && grp.isMixed) {
            this.appendValueNode(doc, el, grp.genValue(), grp.isStringType && useCdataForStrings);
        }
        if (grp.isChoice) {
            let choiceChild: InstanceGroup | null = null;
            let maxChildren = -1;
            const count = grp.getNumberOfChildren();
            for (let i = 0; i < count; i++) {
                const childGroup = grp.getChildGroup(i);
                const numChildren = childGroup ? childGroup.getNumberOfChildren() : 0;
                if (childGroup && numChildren > maxChildren) {
                    choiceChild = childGroup;
                    maxChildren = numChildren;
                }
            }
            if (choiceChild) {
                if (choiceChild instanceof InstanceElement) {
                    this.processElement(doc, choiceChild, el, useCdataForStrings);
                } else {
                    this.processGroup(doc, choiceChild, el, useCdataForStrings);
                }
            }
        } else {
            const count = grp.getNumberOfChildren();
            for (let i = 0; i < count; i++) {
                const childGroup = grp.getChildGroup(i);
                if (!childGroup) continue;
                if (childGroup instanceof InstanceElement) {
                    this.processElement(doc, childGroup, el, useCdataForStrings);
                } else {
                    this.processGroup(doc, childGroup, el, useCdataForStrings);
                }
            }
        }
    }

    private processElementValue(doc: Document, elem: InstanceElement, el: Element, useCdataForStrings: boolean): void {
        if (!elem.child) {
            const val = elem.genValue();
            if (val !== '') {
                const wrapInCdata = useCdataForStrings && (elem.isStringType || isStringXsdType(elem.valueGenerator?.dataType || ''));
                this.appendValueNode(doc, el, val, wrapInCdata);
            }
        }
    }

    private appendValueNode(doc: Document, el: Element, value: string, useCdata: boolean): void {
        if (useCdata) {
            const cleanValue = value.startsWith('<![CDATA[') && value.endsWith(']]>')
                ? value.slice(9, -3)
                : value;
            el.appendChild(doc.createCDATASection(cleanValue));
        } else {
            el.appendChild(doc.createTextNode(value));
        }
    }

    private isEntered(el: Element): boolean {
        return this.elementTypesProcessed.indexOf(el) !== -1;
    }

    private generateElement(el: Element, parentEl?: InstanceGroup): InstanceElement | null {
        let globalDecl: Element | null =
            el.parentNode && getLocalName(el.parentNode) === 'schema' ? el : null;

        const refAttr = el.getAttribute('ref');
        const ref = refAttr ? XmlQualifiedName.fromElement(el, refAttr, this.prefixMap) : null;
        if (ref) {
            globalDecl = this.globalElements[ref.full] || this.globalElementsByLocal[ref.localName] || null;
            if (!globalDecl) {
                return null;
            }
        }

        const targetDecl = globalDecl || el;
        if (this.isEntered(targetDecl)) {
            return null;
        }
        this.elementTypesProcessed.push(targetDecl);

        const schema = findClosestSchemaElement(targetDecl);
        let targetNamespace: string | null = schema ? schema.getAttribute('targetNamespace') : null;
        const qualifiedElements = schema ? schema.getAttribute('elementFormDefault') === 'qualified' : false;
        const formAttr = el.getAttribute('form');
        if (formAttr === 'unqualified') {
            targetNamespace = null;
        } else if (formAttr === 'qualified') {
            // Keep schema targetNamespace
        } else if (parentEl && !globalDecl && !qualifiedElements) {
            targetNamespace = null;
        }

        const elem = new InstanceElement();
        elem.parent = parentEl || null;
        elem.qname = new XmlQualifiedName(targetNamespace, targetDecl.getAttribute('name'));

        // Attach to parent if minOccurs != 0 or maxOccurs >= 1
        const maxOccursRaw = el.getAttribute('maxOccurs') || globalDecl?.getAttribute('maxOccurs');
        const maxOccurs = maxOccursRaw === 'unbounded' ? Infinity : Number(maxOccursRaw || 1);
        const minOccursRaw = el.getAttribute('minOccurs') || globalDecl?.getAttribute('minOccurs');
        const minOccurs = Number(minOccursRaw || 1);
        if (minOccurs > 0 || maxOccurs >= 1) {
            if (parentEl) {
                parentEl.addChild(elem);
            }
        }
        elem.minOccurs = minOccurs;
        elem.maxOccurs = maxOccurs;

        // Default or fixed value
        const defaultValue = el.getAttribute('default') || globalDecl?.getAttribute('default');
        const fixedValue = el.getAttribute('fixed') || globalDecl?.getAttribute('fixed');
        if (fixedValue != null && fixedValue !== '') {
            elem.fixedValue = fixedValue;
        } else if (defaultValue != null && defaultValue !== '') {
            elem.defaultValue = defaultValue;
        }

        // Nillable
        const isNillable = el.getAttribute('nillable') || globalDecl?.getAttribute('nillable');
        elem.isNillable = isNillable === 'true' || isNillable === '1';

        const typeEl = this.getType(targetDecl);
        if (typeEl && getLocalName(typeEl) === 'complexType') {
            // If typeEl has a global name attribute (referenced via type="tns:SomeModel"), it is a class-based model
            if (typeEl.getAttribute('name')) {
                elem.fromNamedComplexType = true;
            }
            if (!this.isEntered(typeEl)) {
                this.elementTypesProcessed.push(typeEl);
                this.processComplexType(typeEl, elem);
                this.elementTypesProcessed.pop();
            }
        } else {
            const dataType = this.getSimpleDataType(typeEl, targetDecl);
            elem.valueGenerator = XmlValueGenerator.createGenerator(dataType, this.listLength, elem.minOccurs);
            elem.isStringType = isStringXsdType(dataType);
        }

        this.elementTypesProcessed.pop();
        return elem;
    }

    private processComplexType(typeEl: Element, elem: InstanceGroup): void {
        if (elem instanceof InstanceElement && typeEl.getAttribute('mixed') === 'true') {
            elem.isMixed = true;
            elem.valueGenerator = XmlValueGenerator.createGenerator('anyType', this.listLength, elem.minOccurs);
            elem.isStringType = true;
        }

        const base = typeEl.getAttribute('base');
        if (base) {
            const baseQName = XmlQualifiedName.fromElement(typeEl, base, this.prefixMap);
            const baseType = this.globalTypes[baseQName.full] || this.globalTypesByLocal[baseQName.localName];
            if (baseType && !this.isEntered(baseType)) {
                this.elementTypesProcessed.push(baseType);
                this.processComplexType(baseType, elem);
                this.elementTypesProcessed.pop();
            }
        }

        const children = typeEl.childNodes;
        for (let i = 0; i < children.length; i++) {
            const ch = children[i];
            if (ch.nodeType === 1) {
                this.generateParticle(ch as Element, elem);
            }
        }
    }

    private generateParticle(particle: Element, iGrp: InstanceGroup): void {
        const pName = getLocalName(particle);

        if (pName === 'element') {
            this.generateElement(particle, iGrp);
            return;
        }

        if (pName === 'attribute' && iGrp instanceof InstanceElement) {
            const attrName = particle.getAttribute('name');
            const use = particle.getAttribute('use');
            if (attrName && use !== 'prohibited') {
                const attr = new InstanceAttribute();
                attr.qname = new XmlQualifiedName('', attrName);
                attr.defaultValue = particle.getAttribute('default');
                attr.fixedValue = particle.getAttribute('fixed');
                const attrTypeAttr = particle.getAttribute('type');
                const attrDataType = attrTypeAttr
                    ? XmlQualifiedName.fromElement(particle, attrTypeAttr, this.prefixMap).localName
                    : 'string';
                attr.valueGenerator = XmlValueGenerator.createGenerator(
                    attrDataType,
                    this.listLength,
                    use === 'required' ? 1 : 0
                );
                iGrp.addAttribute(attr);
            }
            return;
        }

        if (pName === 'group') {
            const refAttr = particle.getAttribute('ref');
            if (refAttr) {
                const refQName = XmlQualifiedName.fromElement(particle, refAttr, this.prefixMap);
                const groupDecl = this.globalGroups[refQName.full] || this.globalGroupsByLocal[refQName.localName];
                if (groupDecl && !this.isEntered(groupDecl)) {
                    this.elementTypesProcessed.push(groupDecl);
                    for (const ch of getDirectElementChildren(groupDecl)) {
                        this.generateParticle(ch, iGrp);
                    }
                    this.elementTypesProcessed.pop();
                }
            }
            return;
        }

        if (pName === 'sequence' || pName === 'all') {
            const grp = new InstanceGroup();
            const maxOccursRaw = particle.getAttribute('maxOccurs');
            const maxOccurs = maxOccursRaw === 'unbounded' ? Infinity : Number(maxOccursRaw || 1);
            const minOccurs = Number(particle.getAttribute('minOccurs') || 1);
            if (minOccurs > 0 || maxOccurs >= 1) {
                iGrp.addChild(grp);
            }
            grp.minOccurs = minOccurs;
            grp.maxOccurs = maxOccurs;
            for (const ch of getDirectElementChildren(particle)) {
                this.generateParticle(ch, grp);
            }
            return;
        }

        if (pName === 'choice') {
            const grp = new InstanceGroup();
            const maxOccursRaw = particle.getAttribute('maxOccurs');
            const maxOccurs = maxOccursRaw === 'unbounded' ? Infinity : Number(maxOccursRaw || 1);
            const minOccurs = Number(particle.getAttribute('minOccurs') || 1);
            if (minOccurs > 0 || maxOccurs >= 1) {
                iGrp.addChild(grp);
            }
            grp.minOccurs = minOccurs;
            grp.maxOccurs = maxOccurs;
            grp.isChoice = true;
            for (const ch of getDirectElementChildren(particle)) {
                this.generateParticle(ch, grp);
            }
            return;
        }

        if (pName === 'any') {
            const elem = new InstanceElement();
            elem.parent = iGrp;
            elem.qname = new XmlQualifiedName('', 'any_element');
            const maxOccursRaw = particle.getAttribute('maxOccurs');
            const maxOccurs = maxOccursRaw === 'unbounded' ? Infinity : Number(maxOccursRaw || 1);
            const minOccurs = Number(particle.getAttribute('minOccurs') || 1);
            if (minOccurs > 0 || maxOccurs >= 1) {
                iGrp.addChild(elem);
            }
            elem.minOccurs = minOccurs;
            elem.maxOccurs = maxOccurs;
            elem.valueGenerator = XmlValueGenerator.createGenerator('anyType', this.listLength, elem.minOccurs);
            elem.isStringType = true;
            return;
        }

        if (pName === 'complexContent' || pName === 'simpleContent') {
            for (const ch of getDirectElementChildren(particle)) {
                this.generateParticle(ch, iGrp);
            }
            return;
        }

        if (pName === 'extension' || pName === 'restriction') {
            const base = particle.getAttribute('base');
            if (base) {
                const baseTypeQName = XmlQualifiedName.fromElement(particle, base, this.prefixMap);
                const baseType = this.globalTypes[baseTypeQName.full] || this.globalTypesByLocal[baseTypeQName.localName];
                if (baseType) {
                    if (getLocalName(baseType) === 'complexType') {
                        if (!this.isEntered(baseType)) {
                            this.elementTypesProcessed.push(baseType);
                            this.processComplexType(baseType, iGrp);
                            this.elementTypesProcessed.pop();
                        }
                    } else if (iGrp instanceof InstanceElement) {
                        const dt = this.getSimpleDataType(baseType, baseType);
                        iGrp.valueGenerator = XmlValueGenerator.createGenerator(dt, this.listLength, iGrp.minOccurs);
                        iGrp.isStringType = isStringXsdType(dt);
                    }
                } else if (iGrp instanceof InstanceElement) {
                    // Built-in simpleType base inside simpleContent extension/restriction
                    const dt = baseTypeQName.localName || 'string';
                    iGrp.valueGenerator = XmlValueGenerator.createGenerator(dt, this.listLength, iGrp.minOccurs);
                    iGrp.isStringType = isStringXsdType(dt);
                }
            }
            for (const ch of getDirectElementChildren(particle)) {
                this.generateParticle(ch, iGrp);
            }
        }
    }

    private getType(el: Element): Element | null {
        for (const ch of getDirectElementChildren(el)) {
            const ln = getLocalName(ch);
            if (ln === 'complexType' || ln === 'simpleType') {
                return ch;
            }
        }
        const typeName = el.getAttribute('type');
        if (typeName) {
            const typeQName = XmlQualifiedName.fromElement(el, typeName, this.prefixMap);
            return this.globalTypes[typeQName.full] || this.globalTypesByLocal[typeQName.localName] || null;
        }
        return null;
    }

    private getSimpleDataType(typeEl: Element | null, parentEl: Element): string {
        if (!typeEl) {
            const type = parentEl.getAttribute('type');
            if (!type) {
                return 'anyType';
            }
            return XmlQualifiedName.fromElement(parentEl, type, this.prefixMap).localName;
        }
        if (getLocalName(typeEl) === 'simpleType') {
            for (const el of getDirectElementChildren(typeEl)) {
                const ln = getLocalName(el);
                if (ln === 'restriction') {
                    const base = el.getAttribute('base');
                    if (base) {
                        return XmlQualifiedName.fromElement(el, base, this.prefixMap).localName;
                    }
                    return 'unknownRestriction';
                }
                if (ln === 'list') {
                    return 'list';
                }
                if (ln === 'union') {
                    return 'union';
                }
            }
        }
        return 'unknown';
    }

    private initGlobalElements(): void {
        for (const schema of this.schemas) {
            const targetNS = schema.getAttribute('targetNamespace') || '';
            for (const el of getDirectElementChildren(schema, 'element')) {
                const name = el.getAttribute('name') || '';
                if (!name) continue;
                this.globalElements[`${targetNS}:${name}`] = el;
                if (!this.globalElementsByLocal[name]) {
                    this.globalElementsByLocal[name] = el;
                }
            }
        }
    }

    private initGlobalTypes(): void {
        for (const schema of this.schemas) {
            const targetNS = schema.getAttribute('targetNamespace') || '';
            for (const el of getDirectElementChildren(schema)) {
                const ln = getLocalName(el);
                if (ln === 'complexType' || ln === 'simpleType') {
                    const name = el.getAttribute('name') || '';
                    if (!name) continue;
                    this.globalTypes[`${targetNS}:${name}`] = el;
                    if (!this.globalTypesByLocal[name]) {
                        this.globalTypesByLocal[name] = el;
                    }
                }
            }
        }
    }

    private initGlobalGroups(): void {
        for (const schema of this.schemas) {
            const targetNS = schema.getAttribute('targetNamespace') || '';
            for (const el of getDirectElementChildren(schema, 'group')) {
                const name = el.getAttribute('name') || '';
                if (!name) continue;
                this.globalGroups[`${targetNS}:${name}`] = el;
                if (!this.globalGroupsByLocal[name]) {
                    this.globalGroupsByLocal[name] = el;
                }
            }
        }
    }
}

interface WsdlMessagePart {
    name: string;
    element: XmlQualifiedName | null;
    type: XmlQualifiedName | null;
}

interface WsdlMessage {
    name: string;
    targetNamespace: string;
    parts: Record<string, WsdlMessagePart>;
}

interface WsdlPortTypeOperation {
    name: string;
    documentation: string;
    input: { name: string | null; message: XmlQualifiedName | null } | null;
    output: { name: string | null; message: XmlQualifiedName | null } | null;
}

interface WsdlPortType {
    name: string;
    operations: Record<string, WsdlPortTypeOperation>;
}

interface WsdlHeaderBinding {
    message: XmlQualifiedName | null;
    part: string;
    use: string | null;
    encodingStyles: string[];
    namespace: string | null;
}

interface WsdlBodyBinding {
    parts: string[];
    use: string | null;
    encodingStyles: string[];
    namespace: string | null;
}

interface WsdlBindingOperation {
    name: string;
    action: string | null;
    soapVersion: '1.1' | '1.2';
    style: 'document' | 'rpc';
    headers: WsdlHeaderBinding[] | null;
    body: WsdlBodyBinding | null;
    input?: { name: string | null; message: XmlQualifiedName | null } | null;
    output?: { name: string | null; message: XmlQualifiedName | null } | null;
    namespace?: string;
    portTypeName?: string;
}

interface WsdlBinding {
    name: string;
    type: XmlQualifiedName | null;
    verb: string | null;
    transport: string | null;
    style: 'document' | 'rpc';
    isHttpBinding: boolean;
    isSoap12: boolean;
    operations: Record<string, WsdlBindingOperation>;
}

function stripWsdlQuery(url: string): string {
    return url.replace(/\?(single)?wsdl$/i, '').trim();
}

/**
 * Extracts `<wsdl:import location="..."/>`, `<xsd:import schemaLocation="..."/>`, and
 * `<xsd:include schemaLocation="..."/>` URLs from a WSDL or XSD XML document.
 */
export function extractWsdlSchemaLocations(xmlText: string, baseUrl: string): string[] {
    if (!xmlText || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
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
        && (/schemas\.xmlsoap\.org\/wsdl/i.test(sample)
            || /www\.w3\.org\/ns\/wsdl/i.test(sample)
            || /<\s*(?:[a-zA-Z0-9_-]+:)?portType\b/i.test(text)
            || /<\s*(?:[a-zA-Z0-9_-]+:)?binding\b/i.test(text));
}

function collectPrefixesFromDoc(doc: Document, map: Map<string, string>): void {
    const els = [doc.documentElement, ...getAllElementsByLocalName(doc, 'definitions'), ...getAllElementsByLocalName(doc, 'schema')];
    for (const el of els) {
        if (!el || !el.attributes) continue;
        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.name.startsWith('xmlns:')) {
                const prefix = attr.name.slice(6);
                if (prefix && attr.value && !map.has(prefix)) {
                    map.set(prefix, attr.value);
                }
            }
        }
    }
}

/**
 * Parses a WSDL XML string (plus any fetched imported WSDL/XSD documents) into OnSteroid SOAP
 * Request definitions using Wizdler's WSDL + XSD sample generation algorithm and `<![CDATA[...]]>`
 * wrapping for SOAP `<Body>` string elements.
 */
export function parseWsdlToRequests(
    wsdlXml: string,
    sourceUrl: string,
    extraXmls: string[] = []
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

    const allDocs: Document[] = [wsdlDoc];
    for (const extra of extraXmls) {
        if (!extra) continue;
        try {
            const xdoc = parser.parseFromString(extra, 'text/xml');
            if (xdoc.getElementsByTagName('parsererror').length === 0) {
                allDocs.push(xdoc);
            }
        } catch {
            // Ignore malformed auxiliary XML
        }
    }

    const prefixMap = new Map<string, string>();
    for (const doc of allDocs) {
        collectPrefixesFromDoc(doc, prefixMap);
    }

    const root = wsdlDoc.documentElement;
    const targetNamespace = root.getAttribute('targetNamespace') || '';

    const serviceEl = getAllElementsByLocalName(wsdlDoc, 'service')[0];
    let serviceName = serviceEl?.getAttribute('name') || root.getAttribute('name') || '';
    if (!serviceName) {
        try {
            const seg = new URL(fallbackUrl).pathname.split('/').filter(Boolean).pop() || 'SOAP Service';
            serviceName = seg.replace(/\.(asmx|svc|wsdl)$/i, '');
        } catch {
            serviceName = 'SOAP Service';
        }
    }

    // Collect all <xs:schema> elements across the primary WSDL and all imported WSDL/XSD documents
    const schemas: Element[] = [];
    for (const doc of allDocs) {
        const docRoot = doc.documentElement;
        if (!docRoot) continue;
        if (getLocalName(docRoot).toLowerCase() === 'schema') {
            schemas.push(docRoot);
        } else {
            for (const s of getAllElementsByLocalName(doc, 'schema')) {
                schemas.push(s);
            }
        }
    }

    const generator = new XmlSampleGenerator(schemas, prefixMap);

    // Collect all WSDL definition roots across primary + imported WSDL documents
    const definitionRoots: Element[] = [];
    for (const doc of allDocs) {
        const docRoot = doc.documentElement;
        if (docRoot && getLocalName(docRoot).toLowerCase() === 'definitions') {
            definitionRoots.push(docRoot);
        }
    }

    // 1. Parse messages (Wizdler _parseMessages)
    const messages: Record<string, WsdlMessage> = {};
    const messagesByLocal: Record<string, WsdlMessage> = {};
    for (const defEl of definitionRoots) {
        const defNs = defEl.getAttribute('targetNamespace') || '';
        for (const msgEl of getDirectElementChildren(defEl, 'message')) {
            const name = msgEl.getAttribute('name') || '';
            if (!name) continue;
            const parts: Record<string, WsdlMessagePart> = {};
            for (const partEl of getDirectElementChildren(msgEl, 'part')) {
                const partName = partEl.getAttribute('name') || 'parameters';
                const elementAttr = partEl.getAttribute('element');
                const typeAttr = partEl.getAttribute('type');
                parts[partName] = {
                    name: partName,
                    element: elementAttr ? XmlQualifiedName.fromElement(partEl, elementAttr, prefixMap) : null,
                    type: typeAttr ? XmlQualifiedName.fromElement(partEl, typeAttr, prefixMap) : null
                };
            }
            const msgObj: WsdlMessage = { name, targetNamespace: defNs, parts };
            messages[`${defNs}:${name}`] = msgObj;
            if (!messagesByLocal[name]) {
                messagesByLocal[name] = msgObj;
            }
        }
    }

    // 2. Parse portTypes (Wizdler _parsePortTypes)
    const portTypes: Record<string, WsdlPortType> = {};
    const portTypesByLocal: Record<string, WsdlPortType> = {};
    for (const defEl of definitionRoots) {
        const defNs = defEl.getAttribute('targetNamespace') || '';
        for (const ptEl of getDirectElementChildren(defEl, 'portType')) {
            const ptName = ptEl.getAttribute('name') || '';
            if (!ptName) continue;
            const operations: Record<string, WsdlPortTypeOperation> = {};
            for (const opEl of getDirectElementChildren(ptEl, 'operation')) {
                const opName = opEl.getAttribute('name') || '';
                if (!opName) continue;
                const docEl = getDirectElementChildren(opEl, 'documentation')[0];
                const inputEl = getDirectElementChildren(opEl, 'input')[0];
                const outputEl = getDirectElementChildren(opEl, 'output')[0];
                const inMsgAttr = inputEl?.getAttribute('message');
                const outMsgAttr = outputEl?.getAttribute('message');

                operations[opName] = {
                    name: opName,
                    documentation: docEl?.textContent?.trim() || '',
                    input: inputEl
                        ? {
                              name: inputEl.getAttribute('name'),
                              message: inMsgAttr ? XmlQualifiedName.fromElement(inputEl, inMsgAttr, prefixMap) : null
                          }
                        : null,
                    output: outputEl
                        ? {
                              name: outputEl.getAttribute('name'),
                              message: outMsgAttr ? XmlQualifiedName.fromElement(outputEl, outMsgAttr, prefixMap) : null
                          }
                        : null
                };
            }
            const ptObj: WsdlPortType = { name: ptName, operations };
            portTypes[`${defNs}:${ptName}`] = ptObj;
            if (!portTypesByLocal[ptName]) {
                portTypesByLocal[ptName] = ptObj;
            }
        }
    }

    // 3. Parse bindings (Wizdler _parseBindings)
    const bindings: Record<string, WsdlBinding> = {};
    const bindingsByLocal: Record<string, WsdlBinding> = {};
    for (const defEl of definitionRoots) {
        const defNs = defEl.getAttribute('targetNamespace') || '';
        for (const bindEl of getDirectElementChildren(defEl, 'binding')) {
            const bindName = bindEl.getAttribute('name') || '';
            if (!bindName) continue;
            const typeAttr = bindEl.getAttribute('type');
            const bindType = typeAttr ? XmlQualifiedName.fromElement(bindEl, typeAttr, prefixMap) : null;

            let soapBindingEl: Element | null = null;
            let httpBindingEl: Element | null = null;
            let isSoap12 = false;

            for (const ch of getDirectElementChildren(bindEl)) {
                if (getLocalName(ch) === 'binding') {
                    const ns = ch.namespaceURI || '';
                    if (ns === HTTP_BINDING_NS || ns.toLowerCase().includes('/wsdl/http')) {
                        httpBindingEl = ch;
                    } else if (ns === SOAP12_BINDING_NS || ch.nodeName.toLowerCase().includes('soap12')) {
                        soapBindingEl = ch;
                        isSoap12 = true;
                    } else if (ns === SOAP11_BINDING_NS || !soapBindingEl) {
                        soapBindingEl = ch;
                    }
                }
            }

            const defaultStyle: 'document' | 'rpc' =
                soapBindingEl?.getAttribute('style') === 'rpc' ? 'rpc' : 'document';

            const operations: Record<string, WsdlBindingOperation> = {};
            for (const opEl of getDirectElementChildren(bindEl, 'operation')) {
                const opName = opEl.getAttribute('name') || '';
                if (!opName) continue;

                let soapOpEl: Element | null = null;
                let opSoapVersion: '1.1' | '1.2' = isSoap12 ? '1.2' : '1.1';
                for (const ch of getDirectElementChildren(opEl)) {
                    if (getLocalName(ch) === 'operation') {
                        soapOpEl = ch;
                        if (ch.namespaceURI === SOAP12_BINDING_NS || ch.nodeName.toLowerCase().includes('soap12')) {
                            opSoapVersion = '1.2';
                        } else if (ch.namespaceURI === SOAP11_BINDING_NS) {
                            opSoapVersion = '1.1';
                        }
                    }
                }

                const styleAttr = soapOpEl?.getAttribute('style');
                const opStyle: 'document' | 'rpc' =
                    styleAttr === 'rpc' || styleAttr === 'document' ? styleAttr : defaultStyle;
                const action = soapOpEl?.getAttribute('soapAction') ?? null;

                const inputEl = getDirectElementChildren(opEl, 'input')[0];
                let headers: WsdlHeaderBinding[] | null = null;
                let body: WsdlBodyBinding | null = null;

                if (inputEl) {
                    const headerEls = getDirectElementChildren(inputEl, 'header');
                    if (headerEls.length > 0) {
                        headers = headerEls.map(hEl => {
                            const msgAttr = hEl.getAttribute('message');
                            return {
                                message: msgAttr ? XmlQualifiedName.fromElement(hEl, msgAttr, prefixMap) : null,
                                part: hEl.getAttribute('part') || '',
                                use: hEl.getAttribute('use'),
                                encodingStyles: (hEl.getAttribute('encodingStyle') || '').split(' ').filter(Boolean),
                                namespace: hEl.getAttribute('namespace')
                            };
                        });
                    }

                    const bodyEl = getDirectElementChildren(inputEl, 'body')[0];
                    if (bodyEl) {
                        body = {
                            parts: (bodyEl.getAttribute('parts') || '').split(' ').filter(Boolean),
                            use: bodyEl.getAttribute('use'),
                            encodingStyles: (bodyEl.getAttribute('encodingStyle') || '').split(' ').filter(Boolean),
                            namespace: bodyEl.getAttribute('namespace')
                        };
                    }
                }

                operations[opName] = {
                    name: opName,
                    action,
                    soapVersion: opSoapVersion,
                    style: opStyle,
                    headers,
                    body,
                    namespace: defNs
                };
            }

            const bindObj: WsdlBinding = {
                name: bindName,
                type: bindType,
                verb: httpBindingEl?.getAttribute('verb') || null,
                transport: soapBindingEl?.getAttribute('transport') || null,
                style: defaultStyle,
                isHttpBinding: !!httpBindingEl && !soapBindingEl,
                isSoap12,
                operations
            };
            bindings[`${defNs}:${bindName}`] = bindObj;
            if (!bindingsByLocal[bindName]) {
                bindingsByLocal[bindName] = bindObj;
            }
        }
    }

    // 4. Parse services and map ports to bindings (Wizdler _parseServices)
    interface PortBindingEntry {
        portName: string;
        address: string;
        binding: WsdlBinding;
        isSoap12: boolean;
    }

    const portEntries: PortBindingEntry[] = [];
    const boundBindingNames = new Set<string>();
    let defaultEndpointUrl = fallbackUrl;

    for (const defEl of definitionRoots) {
        for (const svcEl of getDirectElementChildren(defEl, 'service')) {
            for (const portEl of getDirectElementChildren(svcEl, 'port')) {
                const portName = portEl.getAttribute('name') || '';
                const bindAttr = portEl.getAttribute('binding');
                if (!bindAttr) continue;
                const bindQName = XmlQualifiedName.fromElement(portEl, bindAttr, prefixMap);
                const binding = bindings[bindQName.full] || bindingsByLocal[bindQName.localName];
                if (!binding || binding.isHttpBinding) continue;

                let addressEl: Element | null = null;
                let isSoap12 = binding.isSoap12;
                for (const ch of getDirectElementChildren(portEl)) {
                    if (getLocalName(ch) === 'address') {
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

                boundBindingNames.add(binding.name);
                portEntries.push({
                    portName,
                    address: loc || fallbackUrl,
                    binding,
                    isSoap12
                });
            }
        }
    }

    // Also include any SOAP bindings not referenced by a <service>/<port>
    for (const binding of Object.values(bindingsByLocal)) {
        if (binding.isHttpBinding || boundBindingNames.has(binding.name)) continue;
        portEntries.push({
            portName: binding.name,
            address: defaultEndpointUrl,
            binding,
            isSoap12: binding.isSoap12
        });
    }

    // Sort SOAP 1.1 before SOAP 1.2 so primary SOAP 1.1 requests take precedence when deduplicating
    portEntries.sort((a, b) => (a.isSoap12 ? 1 : 0) - (b.isSoap12 ? 1 : 0));

    // Helper: Wizdler _generateSoapMessage
    const generateSoapMessage = (op: WsdlBindingOperation): string => {
        const envNs = op.soapVersion === '1.2' ? SOAP12_ENV_NS : SOAP11_ENV_NS;
        const impl = wsdlDoc.implementation || (typeof document !== 'undefined' ? document.implementation : null);
        if (!impl) return '';

        const doc = impl.createDocument(envNs, 'Envelope', null);
        const envRoot = doc.documentElement;

        // Generate <Header> if binding operation defines <soap:header>
        if (op.headers && op.headers.length > 0) {
            const hdrEl = doc.createElementNS(envNs, 'Header');
            for (const header of op.headers) {
                if (!header.message) continue;
                const msg = messages[header.message.full] || messagesByLocal[header.message.localName];
                if (!msg) continue;
                const part = msg.parts[header.part] || Object.values(msg.parts)[0];
                if (!part) continue;

                if (part.element) {
                    const el = generator.writeXml(part.element, false);
                    if (el) hdrEl.appendChild(doc.importNode(el, true));
                } else if (part.type) {
                    const el = generator.writeTypedElement(
                        part.name,
                        header.namespace || msg.targetNamespace || '',
                        part.type,
                        false
                    );
                    if (el) hdrEl.appendChild(doc.importNode(el, true));
                }
            }
            if (hdrEl.childNodes.length > 0) {
                envRoot.appendChild(hdrEl);
            }
        }

        // Generate <Body> with CDATA wrapping enabled for string values
        const bodyEl = doc.createElementNS(envNs, 'Body');
        envRoot.appendChild(bodyEl);

        if (op.input && op.input.message) {
            const msg = messages[op.input.message.full] || messagesByLocal[op.input.message.localName];
            if (msg) {
                if (op.style === 'rpc') {
                    const rpcNs = op.body?.namespace || op.namespace || targetNamespace || '';
                    const rpcRoot = doc.createElementNS(rpcNs || '\0', op.name);
                    bodyEl.appendChild(rpcRoot);

                    const bodyParts =
                        op.body && op.body.parts && op.body.parts.length > 0
                            ? op.body.parts
                            : Object.keys(msg.parts);

                    for (const partName of bodyParts) {
                        const part = msg.parts[partName];
                        if (!part) continue;
                        if (part.element) {
                            const el = generator.writeXml(part.element, true);
                            if (el) rpcRoot.appendChild(doc.importNode(el, true));
                        } else if (part.type) {
                            const el = generator.writeTypedElement(part.name, '', part.type, true);
                            if (el) rpcRoot.appendChild(doc.importNode(el, true));
                        }
                    }
                } else {
                    const bodyParts =
                        op.body && op.body.parts && op.body.parts.length > 0
                            ? op.body.parts
                            : Object.keys(msg.parts);

                    for (const partName of bodyParts) {
                        const part = msg.parts[partName];
                        if (!part) continue;
                        if (part.element) {
                            const el = generator.writeXml(part.element, true);
                            if (el) bodyEl.appendChild(doc.importNode(el, true));
                        } else if (part.type) {
                            const el = generator.writeTypedElement(
                                part.name,
                                op.body?.namespace || op.namespace || msg.targetNamespace || '',
                                part.type,
                                true
                            );
                            if (el) bodyEl.appendChild(doc.importNode(el, true));
                        }
                    }
                }
            }
        }

        // If <Body> is still empty (e.g. operation message had no resolvable schema element), emit operation tag
        if (bodyEl.childNodes.length === 0) {
            const fallbackOpEl = doc.createElementNS(op.namespace || targetNamespace || '\0', op.name);
            bodyEl.appendChild(fallbackOpEl);
        }

        let xml = new XMLSerializer().serializeToString(doc);
        xml = xml.replace(/ xmlns="(?:\0|&#0;|&#x0;)"/g, ' xmlns=""');
        return formatXmlPretty(xml);
    };

    const requests: WsdlParsedRequest[] = [];
    const seenPortTypeOps = new Set<string>();
    const usedRequestNames = new Set<string>();

    for (const entry of portEntries) {
        const binding = entry.binding;
        const pt = binding.type
            ? portTypes[binding.type.full] || portTypesByLocal[binding.type.localName]
            : null;
        const ptKey = pt?.name || binding.type?.localName || binding.name;

        for (const opName of Object.keys(binding.operations)) {
            const bindOp = binding.operations[opName];
            const dedupKey = `${ptKey}::${opName}`;
            if (seenPortTypeOps.has(dedupKey)) continue;
            seenPortTypeOps.add(dedupKey);

            const ptOp = pt?.operations[opName];
            const fullOp: WsdlBindingOperation = {
                ...bindOp,
                soapVersion: entry.isSoap12 ? '1.2' : bindOp.soapVersion,
                input: ptOp?.input || null,
                output: ptOp?.output || null,
                namespace: binding.type?.ns || bindOp.namespace || targetNamespace,
                portTypeName: ptKey
            };

            const soapXml = generateSoapMessage(fullOp);
            const isSoap12 = fullOp.soapVersion === '1.2';
            const soapAction = fullOp.action ?? '';

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

            let reqName = opName;
            if (usedRequestNames.has(reqName)) {
                reqName = `${ptKey}.${opName}`;
            }
            usedRequestNames.add(reqName);

            requests.push({
                name: reqName,
                method: 'POST',
                url: entry.address || defaultEndpointUrl,
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

    // Fallback: if no bindings defined at all, synthesize operations directly from <wsdl:portType>
    if (requests.length === 0) {
        for (const pt of Object.values(portTypesByLocal)) {
            for (const op of Object.values(pt.operations)) {
                if (usedRequestNames.has(op.name)) continue;
                usedRequestNames.add(op.name);

                const syntheticOp: WsdlBindingOperation = {
                    name: op.name,
                    action: targetNamespace ? `${targetNamespace.replace(/\/$/, '')}/${op.name}` : op.name,
                    soapVersion: '1.1',
                    style: 'document',
                    headers: null,
                    body: null,
                    input: op.input,
                    output: op.output,
                    namespace: targetNamespace
                };

                const soapXml = generateSoapMessage(syntheticOp);
                requests.push({
                    name: op.name,
                    method: 'POST',
                    url: defaultEndpointUrl,
                    headers: [
                        { enabled: true, key: 'Content-Type', value: 'text/xml; charset=utf-8' },
                        { enabled: true, key: 'SOAPAction', value: `"${syntheticOp.action}"` }
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
 * Emits Wizdler-formatted SOAP XML with `<![CDATA[[string]]]>` wrapping for string values.
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
    const preMatch = opHtml.match(/&lt;\?xml[\s\S]*?&lt;\/soap(?:12)?:Envelope&gt;/i)
        || opHtml.match(/&lt;soap(?:12)?:Envelope[\s\S]*?&lt;\/soap(?:12)?:Envelope&gt;/i)
        || opHtml.match(/<soap(?:12)?:Envelope[\s\S]*?<\/soap(?:12)?:Envelope>/i);
    if (preMatch) {
        const valueMatches = preMatch[0].match(/<font[^>]*class=["']?value["']?[^>]*>[\s\S]*?<\/font>/gi) || [];
        const useCdataForPre = valueMatches.length === 1;
        const withTypedPlaceholders = preMatch[0].replace(
            /<font[^>]*class=["']?value["']?[^>]*>\s*([^<]+?)\s*<\/font>/gi,
            (_m, typeName: string) => {
                const cleanType = typeName.trim();
                return useCdataForPre && isStringXsdType(cleanType)
                    ? `&lt;![CDATA[[${cleanType}]]]&gt;`
                    : `[${cleanType}]`;
            }
        );
        soapXml = withTypedPlaceholders
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/<\?xml[^>]*\?>\s*/i, '')
            .trim();
        soapXml = formatXmlPretty(soapXml);
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
        const useCdataForInputs = inputFields.length === 1;
        const inner = inputFields.length > 0
            ? `<${opName} xmlns="${defaultNamespace}">\n${inputFields.map(f => `  <${f}>${useCdataForInputs ? '<![CDATA[[string]]]>' : '[string]'}</${f}>`).join('\n')}\n</${opName}>`
            : `<${opName} xmlns="${defaultNamespace}"/>`;
        soapXml = formatXmlPretty([
            `<Envelope xmlns="${SOAP11_ENV_NS}">`,
            `  <Body>`,
            ...inner.split('\n').map(l => `    ${l}`),
            `  </Body>`,
            `</Envelope>`
        ].join('\n'));
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
