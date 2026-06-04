/**
 * UBL 2.1 Invoice-generator (SI-UBL 2.0 / NLCIUS-achtig).
 *
 * Genereert geldige, well-formed UBL 2.1 `<Invoice>`-XML uit een factuur-model.
 * V1: geen externe XML-library — we serialiseren met escaping zelf zodat er
 * geen extra dependency nodig is. De output volgt de SI-UBL/Peppol-BIS
 * element-volgorde voor de kern-velden (CustomizationID, ProfileID,
 * AccountingSupplierParty, AccountingCustomerParty, TaxTotal, LegalMonetaryTotal,
 * InvoiceLine). Voldoende om in Moneybird/boekhoud-tools te openen; volledige
 * Peppol-validatie (alle BT-codes) is Fase 4-scope.
 *
 * Bedragen zijn strings in 2-decimalen-vorm (UBL Amount), currencyID = EUR.
 */

export interface UblParty {
  name: string;
  vatNumber?: string; // bv 'NL123456789B01'
  street?: string;
  city?: string;
  postcode?: string;
  country?: string; // ISO-2
  email?: string;
}

export interface UblLine {
  id: string | number;
  description: string;
  quantity: number;
  unitPriceNet: string; // 2-dec, exclusief BTW
  lineNet: string; // 2-dec, exclusief BTW (quantity × unitPriceNet)
  vatRate: number; // 21
}

export interface UblInvoiceInput {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  currency?: string; // default EUR
  type?: 'sales' | 'credit';
  supplier: UblParty;
  customer: UblParty;
  lines: UblLine[];
  /** Totalen in 2-decimalen-strings. */
  taxExclusive: string;
  taxAmount: string;
  taxInclusive: string;
  /** Per-tarief BTW-subtotalen voor TaxSubtotal. */
  taxSubtotals: Array<{ rate: number; taxable: string; tax: string }>;
  note?: string;
}

/** XML-escape voor element-tekst en attribuut-waarden. */
export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function el(tag: string, value: string | number): string {
  return `<${tag}>${xmlEscape(String(value))}</${tag}>`;
}

function partyXml(role: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: UblParty): string {
  const taxScheme = p.vatNumber
    ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(p.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`
    : '';
  return `
  <cac:${role}>
    <cac:Party>
      <cac:PartyName><cbc:Name>${xmlEscape(p.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(p.street ?? '')}</cbc:StreetName>
        <cbc:CityName>${xmlEscape(p.city ?? '')}</cbc:CityName>
        <cbc:PostalZone>${xmlEscape(p.postcode ?? '')}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xmlEscape(p.country ?? 'NL')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>${taxScheme}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xmlEscape(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      ${p.email ? `<cac:Contact><cbc:ElectronicMail>${xmlEscape(p.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>
  </cac:${role}>`;
}

function taxSubtotalXml(currency: string, s: { rate: number; taxable: string; tax: string }): string {
  return `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${xmlEscape(s.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${xmlEscape(s.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${s.rate > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${s.rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
}

function lineXml(currency: string, line: UblLine): string {
  return `
  <cac:InvoiceLine>
    <cbc:ID>${xmlEscape(String(line.id))}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${xmlEscape(String(line.quantity))}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${xmlEscape(line.lineNet)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${xmlEscape(line.description)}</cbc:Description>
      <cbc:Name>${xmlEscape(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${line.vatRate > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${line.vatRate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${xmlEscape(line.unitPriceNet)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

/**
 * Bouw een complete UBL 2.1 Invoice-XML-string. Begint met de XML-declaratie
 * en root-namespaces (Invoice + cac + cbc), conform SI-UBL 2.0.
 */
export function generateUblInvoice(input: UblInvoiceInput): string {
  const currency = input.currency ?? 'EUR';
  const typeCode = input.type === 'credit' ? '381' : '380'; // UNCL1001: 380=invoice, 381=credit note

  const header = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  ${el('cbc:ID', input.invoiceNumber)}
  ${el('cbc:IssueDate', input.issueDate)}
  ${el('cbc:InvoiceTypeCode', typeCode)}
  ${input.note ? el('cbc:Note', input.note) : ''}
  ${el('cbc:DocumentCurrencyCode', currency)}`;

  const parties =
    partyXml('AccountingSupplierParty', input.supplier) +
    partyXml('AccountingCustomerParty', input.customer);

  const taxTotal = `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${xmlEscape(input.taxAmount)}</cbc:TaxAmount>${input.taxSubtotals
    .map((s) => taxSubtotalXml(currency, s))
    .join('')}
  </cac:TaxTotal>`;

  const monetaryTotal = `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${xmlEscape(input.taxExclusive)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${xmlEscape(input.taxExclusive)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${xmlEscape(input.taxInclusive)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${xmlEscape(input.taxInclusive)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  const lines = input.lines.map((l) => lineXml(currency, l)).join('');

  return `${header}${parties}${taxTotal}${monetaryTotal}${lines}
</Invoice>`;
}

/**
 * Minimale well-formedness-check zonder externe parser: balans van open/dicht
 * tags + geen onge-escapete '&'. Bedoeld als zelf-vangnet, niet als XSD-validatie.
 */
export function isWellFormedXml(xml: string): boolean {
  if (!xml.trim().startsWith('<?xml')) return false;
  // losse '&' die geen entity start → niet well-formed
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml)) return false;
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][\w:.-]*)(\s[^>]*?)?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const full = m[0];
    if (full.startsWith('<?') || full.startsWith('<!')) continue;
    const name = m[1];
    if (name === undefined) continue;
    if (full.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else if (!full.endsWith('/>')) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}
