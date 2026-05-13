const STABILITY_API_KEY = process.env.STABILITY_API_KEY || 'sk-8BdzDMxJJKC7xPqV2hHXs5vDF2aWEnaTjI2ea9TpAy1hN1E3';

/**
 * 用 Stability AI img2img 以父母照片为基础生成宝宝照
 */
async function generateBabyFromParent(parentBase64, gender, label) {
  const genderText = gender === 'boy' ? 'baby boy'
    : gender === 'girl' ? 'baby girl'
    : 'newborn baby';

  const prompt = `A photorealistic close-up portrait of a ${genderText}, around 3 months old, soft natural lighting, smooth baby skin, cute expression, high detail, professional DSLR photography, shallow depth of field, warm tones, adorable face`;

  // 把 base64 转成 Buffer → Blob
  const rawBase64 = parentBase64.includes('base64,')
    ? parentBase64.split('base64,')[1]
    : parentBase64;
  const buffer = Buffer.from(rawBase64, 'base64');
  const blob = new Blob([buffer], { type: 'image/jpeg' });

  const formData = new FormData();
  formData.append('init_image', blob, 'parent.jpg');
  formData.append('init_image_mode', 'IMAGE_STRENGTH');
  formData.append('image_strength', '0.35');
  formData.append('text_prompts[0][text]', prompt);
  formData.append('text_prompts[0][weight]', '1');
  formData.append('cfg_scale', '7');
  formData.append('samples', '1');
  formData.append('steps', '30');
  formData.append('style_preset', 'photographic');

  console.log(`[generate] Calling Stability img2img (${label})...`);
  const resp = await fetch(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STABILITY_API_KEY}`,
        'Accept': 'application/json',
      },
      body: formData,
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Stability img2img (${label}) failed: ${resp.status} - ${errText}`);
  }

  const result = await resp.json();
  const base64 = result.artifacts?.[0]?.base64;
  if (!base64) throw new Error(`Stability img2img (${label}) returned no image`);
  return base64;
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body);
    const { orderId, plan, gender, momPhoto, dadPhoto } = body;

    // 安全校验：orderId 必须符合格式 + 必须有照片
    if (!orderId || !orderId.startsWith('BL-')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid orderId' }) };
    }
    if (!momPhoto || !dadPhoto) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parent photos' }) };
    }

    console.log(`[generate] Processing order ${orderId}, plan=${plan}, gender=${gender}`);

    // 以妈妈照片为基础生成一张，以爸爸照片为基础生成一张
    const [babyFromMom, babyFromDad] = await Promise.all([
      generateBabyFromParent(momPhoto, gender || 'both', 'mom'),
      generateBabyFromParent(dadPhoto, gender || 'both', 'dad'),
    ]);

    console.log(`[generate] ✅ Order ${orderId} completed`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId,
        images: { babyFromMom, babyFromDad },
      }),
    };
  } catch (err) {
    console.error('[generate] Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Generation failed', message: err.message }),
    };
  }
};