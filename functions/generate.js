/**
 * BabyLens AI - 生图 API（Cloudflare Pages Function）
 * 
 * 接收父母照片，调 Stability AI img2img 生成宝宝照
 * 访问路径: https://babylens.pages.dev/generate
 */

export async function onRequest(context) {
  const { request, env } = context;
  const STABILITY_API_KEY = env.STABILITY_API_KEY;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const body = await request.json();
    const { orderId, plan, gender, momPhoto, dadPhoto } = body;

    // 安全校验
    if (!orderId || !orderId.startsWith('BL-')) {
      return new Response(JSON.stringify({ error: 'Invalid orderId' }), {
        status: 400,
        headers: corsHeaders,
      });
    }
    if (!momPhoto || !dadPhoto) {
      return new Response(JSON.stringify({ error: 'Missing parent photos' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    console.log(`[generate] Processing order ${orderId}, plan=${plan}, gender=${gender}`);

    // 并行生成两张宝宝照（分别基于妈妈和爸爸的照片）
    const [babyFromMom, babyFromDad] = await Promise.all([
      generateBabyFromParent(momPhoto, gender || 'both', 'mom', STABILITY_API_KEY),
      generateBabyFromParent(dadPhoto, gender || 'both', 'dad', STABILITY_API_KEY),
    ]);

    console.log(`[generate] ✅ Order ${orderId} completed`);
    return new Response(
      JSON.stringify({
        success: true,
        orderId,
        images: { babyFromMom, babyFromDad },
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('[generate] Error:', err.message);
    return new Response(
      JSON.stringify({ error: 'Generation failed', message: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * 用 Stability AI img2img 基于父母照片生成宝宝照
 */
async function generateBabyFromParent(parentBase64, gender, label, apiKey) {
  const genderText =
    gender === 'boy' ? 'baby boy'
    : gender === 'girl' ? 'baby girl'
    : 'newborn baby';

  const prompt = `A photorealistic close-up portrait of a ${genderText}, around 3 months old, soft natural lighting, smooth baby skin, cute expression, high detail, professional DSLR photography, shallow depth of field, warm tones, adorable face`;

  // 提取纯 base64
  const rawBase64 = parentBase64.includes('base64,')
    ? parentBase64.split('base64,')[1]
    : parentBase64;
  const binaryStr = atob(rawBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const formData = new FormData();
  formData.append('init_image', new Blob([bytes], { type: 'image/jpeg' }), 'parent.jpg');
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
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
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