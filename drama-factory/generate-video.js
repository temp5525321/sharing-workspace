const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = (() => {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf-8').match(/GEMINI_API_KEY=(.+)/);
    return match ? match[1].trim() : '';
  }
  return process.env.GEMINI_API_KEY || '';
})();

const DATA_DIR = path.join(__dirname, 'data');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
const VIDEOS_DIR = path.join(__dirname, 'videos');

const VEO_MODEL = 'veo-3.1-generate-preview';
const BASE_URL = 'generativelanguage.googleapis.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── API 요청 헬퍼 ───
function apiRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: `/v1beta/${apiPath}${apiPath.includes('?') ? '&' : '?'}key=${API_KEY}`,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('응답 파싱 실패: ' + data.slice(0, 300)));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── 파일 다운로드 ───
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url + (url.includes('?') ? '&' : '?') + `key=${API_KEY}`);
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'x-goog-api-key': API_KEY },
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    });
    req.on('error', reject);
  });
}

// ─── 영상 생성 (텍스트 → 비디오) ───
async function generateVideo(prompt, options = {}) {
  const body = {
    instances: [{
      prompt,
    }],
    parameters: {
      aspectRatio: options.aspectRatio || '16:9',
      durationSeconds: options.duration || '8',
      resolution: options.resolution || '720p',
      personGeneration: 'allow_all',
      numberOfVideos: 1,
    },
  };

  console.log(`    🎬 영상 생성 요청 중...`);
  const result = await apiRequest('POST', `models/${VEO_MODEL}:predictLongRunning`, body);

  if (result.error) {
    throw new Error(`API 에러: ${result.error.message}`);
  }

  const opName = result.name;
  if (!opName) throw new Error('Operation name이 없습니다: ' + JSON.stringify(result));

  return opName;
}

// ─── 영상 연장 (Scene Extension) ───
async function extendVideo(videoPath, prompt) {
  const videoData = fs.readFileSync(videoPath).toString('base64');

  const body = {
    instances: [{
      prompt,
      video: {
        inlineData: {
          mimeType: 'video/mp4',
          data: videoData,
        },
      },
    }],
    parameters: {
      numberOfVideos: 1,
      resolution: '720p',
    },
  };

  console.log(`    🔗 영상 연장 요청 중...`);
  const result = await apiRequest('POST', `models/${VEO_MODEL}:predictLongRunning`, body);

  if (result.error) {
    throw new Error(`연장 API 에러: ${result.error.message}`);
  }

  return result.name;
}

// ─── 작업 완료 대기 (폴링) ───
async function waitForCompletion(opName, maxWait = 600000) {
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < maxWait) {
    attempts++;
    await sleep(10000); // 10초마다 폴링

    const status = await apiRequest('GET', opName);

    if (status.error) {
      throw new Error(`폴링 에러: ${status.error.message}`);
    }

    if (status.done) {
      const samples = status.response?.generateVideoResponse?.generatedSamples;
      if (samples && samples.length > 0) {
        const videoUri = samples[0].video?.uri;
        if (videoUri) return videoUri;
      }
      throw new Error('영상 URI를 찾을 수 없습니다: ' + JSON.stringify(status.response));
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`    ⏳ 대기 중... (${elapsed}초, ${attempts}번째 확인)\r`);
  }

  throw new Error('타임아웃: 영상 생성이 10분 초과');
}

// ─── 에피소드 전체 생성 ───
async function generateEpisode(scriptPath) {
  const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
  const episodeDir = path.join(VIDEOS_DIR, script.storyId || path.basename(path.dirname(scriptPath)));

  if (!fs.existsSync(episodeDir)) fs.mkdirSync(episodeDir, { recursive: true });

  console.log(`\n🎬 에피소드 생성: ${script.title}`);
  console.log(`   장면 수: ${script.scenes.length}개`);
  console.log(`   저장 위치: ${episodeDir}\n`);

  const sceneFiles = [];

  // 첫 번째 장면 생성
  const firstScene = script.scenes[0];
  const stylePrefix = script.overallStyle ? `${script.overallStyle}, ` : 'cinematic, Korean drama style, ';

  console.log(`  [장면 1/${script.scenes.length}] ${firstScene.description}`);
  const firstOp = await generateVideo(
    stylePrefix + firstScene.videoPrompt,
    { aspectRatio: '16:9', duration: '8', resolution: '720p' }
  );

  const firstUri = await waitForCompletion(firstOp);
  const firstFile = path.join(episodeDir, 'scene_01.mp4');
  await downloadFile(firstUri, firstFile);
  console.log(`    ✅ 장면 1 다운로드 완료\n`);
  sceneFiles.push(firstFile);

  // 나머지 장면: Scene Extension으로 이어붙이기
  let currentVideo = firstFile;

  for (let i = 1; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    console.log(`  [장면 ${i + 1}/${script.scenes.length}] ${scene.description}`);

    try {
      const extOp = await extendVideo(currentVideo, stylePrefix + scene.videoPrompt);
      const extUri = await waitForCompletion(extOp);
      const sceneFile = path.join(episodeDir, `scene_${String(i + 1).padStart(2, '0')}.mp4`);
      await downloadFile(extUri, sceneFile);
      console.log(`    ✅ 장면 ${i + 1} 다운로드 완료\n`);
      sceneFiles.push(sceneFile);
      currentVideo = sceneFile; // 연장된 영상이 다음 연장의 입력
    } catch (e) {
      console.error(`    ❌ 장면 ${i + 1} 실패: ${e.message}`);
      console.log(`    ⚠️  독립 생성으로 폴백...\n`);

      // 폴백: 독립적으로 생성
      try {
        const fallbackOp = await generateVideo(stylePrefix + scene.videoPrompt, {
          aspectRatio: '16:9', duration: '8', resolution: '720p'
        });
        const fallbackUri = await waitForCompletion(fallbackOp);
        const sceneFile = path.join(episodeDir, `scene_${String(i + 1).padStart(2, '0')}.mp4`);
        await downloadFile(fallbackUri, sceneFile);
        console.log(`    ✅ 장면 ${i + 1} (독립) 다운로드 완료\n`);
        sceneFiles.push(sceneFile);
      } catch (e2) {
        console.error(`    ❌ 장면 ${i + 1} 독립 생성도 실패: ${e2.message}\n`);
      }
    }

    // API 레이트 리밋 방지
    await sleep(5000);
  }

  // 메타데이터 저장
  const meta = {
    ...script,
    sceneFiles,
    generatedAt: new Date().toISOString(),
    status: sceneFiles.length === script.scenes.length ? 'complete' : 'partial',
  };
  fs.writeFileSync(path.join(episodeDir, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`\n✅ 에피소드 완료: ${sceneFiles.length}/${script.scenes.length} 장면 생성`);
  return { episodeDir, sceneFiles, meta };
}

// ─── 메인 ───
async function main() {
  console.log('🎬 막장 드라마 영상 생성기 (Veo 3.1)');
  console.log('='.repeat(50));

  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }

  // 특정 스크립트 ID가 인자로 주어진 경우
  const targetId = process.argv[2];

  if (targetId) {
    const scriptFile = path.join(SCRIPTS_DIR, targetId, 'script.json');
    if (!fs.existsSync(scriptFile)) {
      console.error(`❌ 스크립트를 찾을 수 없습니다: ${scriptFile}`);
      process.exit(1);
    }
    await generateEpisode(scriptFile);
    return;
  }

  // 모든 스크립트 처리
  if (!fs.existsSync(SCRIPTS_DIR)) {
    console.error('❌ scripts 폴더가 없습니다. 먼저 스크립트를 생성하세요.');
    process.exit(1);
  }

  const scriptDirs = fs.readdirSync(SCRIPTS_DIR)
    .filter(d => fs.existsSync(path.join(SCRIPTS_DIR, d, 'script.json')));

  if (scriptDirs.length === 0) {
    console.error('❌ 생성된 스크립트가 없습니다.');
    process.exit(1);
  }

  console.log(`\n📋 ${scriptDirs.length}개 에피소드 생성 시작\n`);

  let success = 0;
  for (const dir of scriptDirs) {
    const videoDir = path.join(VIDEOS_DIR, dir);
    if (fs.existsSync(path.join(videoDir, 'meta.json'))) {
      const meta = JSON.parse(fs.readFileSync(path.join(videoDir, 'meta.json'), 'utf-8'));
      if (meta.status === 'complete') {
        console.log(`⏭️  건너뛰기 (완료됨): ${dir}`);
        success++;
        continue;
      }
    }

    try {
      await generateEpisode(path.join(SCRIPTS_DIR, dir, 'script.json'));
      success++;
    } catch (e) {
      console.error(`❌ 에피소드 실패 (${dir}): ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`🎬 전체 완료: ${success}/${scriptDirs.length} 에피소드 생성`);
}

main().catch(console.error);
