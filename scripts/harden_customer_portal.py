from pathlib import Path

path = Path('functions/src/customerPortal.ts')
text = path.read_text()

anchor = """function email(value: unknown) {\n  const valueText = text(value, 220).toLowerCase()\n  return valueText.includes('@') ? valueText : ''\n}\n\n"""
escape = """function escapeHtml(value: unknown) {\n  return text(value, 5000)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;')\n    .replace(/'/g, '&#039;')\n}\n\n"""
if escape not in text:
    if anchor not in text:
        raise SystemExit('email helper anchor missing')
    text = text.replace(anchor, anchor + escape, 1)

text = text.replace("firstText(data, ['publicUrl', 'shareUrl', 'documentUrl'])", "firstText(data, ['publicUrl', 'shareUrl'])")

old_html = """      html: `<p>Hello ${customerDisplayName(customer)},</p><p>${text(brand.storeName, 180) || 'The business'} has shared a secure customer portal with you.</p><p>You can use it to review your bookings, invoices, payment receipts and current balance.</p><p><a href=\"${publicUrl}\">Open your customer portal</a></p><p>This private link expires in ${LINK_LIFETIME_DAYS} days. Do not forward it to anyone you do not trust.</p>`,\n"""
new_html = """      html: `<p>Hello ${escapeHtml(customerDisplayName(customer))},</p><p>${escapeHtml(text(brand.storeName, 180) || 'The business')} has shared a secure customer portal with you.</p><p>You can use it to review your bookings, invoices, payment receipts and current balance.</p><p><a href=\"${publicUrl}\">Open your customer portal</a></p><p>This private link expires in ${LINK_LIFETIME_DAYS} days. Do not forward it to anyone you do not trust.</p>`,\n"""
if old_html in text:
    text = text.replace(old_html, new_html, 1)
elif new_html not in text:
    raise SystemExit('portal email HTML anchor missing')

path.write_text(text)
print('Customer portal hardening applied.')
