const fs = require('fs');
const path = require('path');
const https = require('https');

require('dotenv/config') // will fail gracefully if dotenv not installed
const API_KEY = process.env.GEMINI_API_KEY || (() => {
  // .env 파일에서 직접 읽기 (dotenv 없이)
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf-8').match(/GEMINI_API_KEY=(.+)/);
    return match ? match[1].trim() : '';
  }
  return '';
})();

const DATA_DIR = path.join(__dirname, 'data');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
const SELECTED_FILE = path.join(DATA_DIR, 'selected.json');
const TEMPLATE_FILE = path.join(__dirname, 'templates', 'drama-prompt.txt');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function geminiRequest(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    const parsed = new URL(url);

    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
            return;
          }
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error('JSON 파싱 실패: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateScript(story, template) {
  const prompt = template
    .replace('{{TITLE}}', story.title)
    .replace('{{CONTENT}}', story.content);

  console.log(`  📝 스크립트 생성 중: ${story.title.slice(0, 40)}...`);

  const response = await geminiRequest(prompt);

  // JSON 추출
  let script;
  try {
    script = JSON.parse(response);
  } catch {
    // JSON 블록 추출 시도
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      script = JSON.parse(match[0]);
    } else {
      throw new Error('스크립트 JSON 파싱 실패');
    }
  }

  // 메타데이터 추가
  script.storyId = story.id;
  script.sourceTitle = story.title;
  script.sourceUrl = story.url;
  script.generatedAt = new Date().toISOString();

  return script;
}

async function main() {
  console.log('🎬 막장 드라마 스크립트 자동 생성기');
  console.log('='.repeat(50));

  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.');
    process.exit(1);
  }

  if (!fs.existsSync(SELECTED_FILE)) {
    console.error('❌ selected.json이 없습니다. 먼저 스토리를 선택하세요.');
    process.exit(1);
  }

  const selected = JSON.parse(fs.readFileSync(SELECTED_FILE, 'utf-8'));
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf-8');

  if (selected.length === 0) {
    console.error('❌ 선택된 스토리가 없습니다.');
    process.exit(1);
  }

  console.log(`\n📋 ${selected.length}개 스토리 처리 시작\n`);

  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

  let success = 0;
  let fail = 0;

  for (const story of selected) {
    const scriptDir = path.join(SCRIPTS_DIR, story.id);
    const scriptFile = path.join(scriptDir, 'script.json');

    // 이미 생성된 스크립트 건너뛰기
    if (fs.existsSync(scriptFile)) {
      console.log(`  ⏭️  건너뛰기 (이미 존재): ${story.id}`);
      success++;
      continue;
    }

    try {
      const script = await generateScript(story, template);

      if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2), 'utf-8');

      console.log(`  ✅ 완료: ${script.title} (${script.scenes?.length || 0}장면)`);
      success++;
    } catch (e) {
      console.error(`  ❌ 실패: ${story.title} — ${e.message}`);
      fail++;
    }

    // API 레이트 리밋 방지
    await sleep(3000);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ 성공: ${success}개 | ❌ 실패: ${fail}개`);
  console.log(`📂 스크립트 저장 위치: ${SCRIPTS_DIR}`);
}

main().catch(console.error);
