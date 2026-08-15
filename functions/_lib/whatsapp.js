// Generic WhatsApp Utility/Marketing template sender — distinct from
// otp.js's sendViaWhatsApp, which is Authentication-category-specific (has
// the copy-code button component). These templates are plain body-variable
// substitution, no button, and each needs its own Meta-approved template
// (Authentication templates legally cannot be reused for non-auth messages).
export async function sendWhatsAppTemplate(env, phone, templateName, bodyParams) {
  const mobile = phone.replace('+', '');
  const resp = await fetch('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authkey: env.MSG91_WA_AUTHKEY },
    body: JSON.stringify({
      integrated_number: env.MSG91_WA_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateName,
          language: { code: env.MSG91_WA_TEMPLATE_LANG || 'en', policy: 'deterministic' },
          to_and_components: [{
            to: [mobile],
            components: Object.fromEntries(
              bodyParams.map((v, i) => [`body_${i + 1}`, { type: 'text', value: String(v) }])
            ),
          }],
        },
      },
    }),
  });
  if (!resp.ok) throw new Error('whatsapp_http_' + resp.status);
  const data = await resp.json().catch(() => ({}));
  if (data && data.status && data.status !== 'success') {
    throw new Error('whatsapp_api_' + (data.errors ? JSON.stringify(data.errors) : data.status));
  }
  return data && data.request_id;
}
