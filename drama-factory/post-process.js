const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VIDEOS_DIR = path.join(__dirname, 'videos');
const ASSETS_DIR = path.join(__dirname, 'assets');

// ─── FFmpeg 확인 ───
function checkFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    console.error('❌ FFmpeg가 설치되어 있지 않습니다.');
    console.error('   설치: brew install ffmpeg');
    return false;
  }
}

// ─── SRT 자막 생성 ───
function generateSRT(scenes) {
  let srt = '';
  let currentTime = 0;

  scenes.forEach((scene, i) => {
    const start = formatTime(currentTime);
    const end = formatTime(currentTime + (scene.duration || 8));

    if (scene.subtitleKo) {
      srt += `${i + 1}\n`;
      srt += `${start} --> ${end}\n`;
      srt += `${scene.subtitleKo}\n\n`;
    }

    currentTime += (scene.duration || 8);
  });

  return srt;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

// ─── 장면 병합 ───
function mergeScenes(episodeDir, sceneFiles) {
  const listFile = path.join(episodeDir, 'concat_list.txt');
  const mergedFile = path.join(episodeDir, 'merged.mp4');

  // FFmpeg concat 리스트 생성
  const list = sceneFiles
    .filter(f => fs.existsSync(f))
    .map(f => `file '${f}'`)
    .join('\n');

  fs.writeFileSync(listFile, list);

  console.log(`  🔗 ${sceneFiles.length}개 장면 병합 중...`);

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${mergedFile}" 2>/dev/null`,
    { cwd: episodeDir }
  );

  // 임시 파일 정리
  fs.unlinkSync(listFile);

  console.log(`  ✅ 병합 완료: merged.mp4`);
  return mergedFile;
}

// ─── 자막 합성 ───
function addSubtitles(inputFile, srtFile, outputFile) {
  console.log(`  📝 자막 합성 중...`);

  // 시스템 한글 폰트 찾기
  let fontPath = '';
  const fontCandidates = [
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
    '/Library/Fonts/NanumGothicBold.ttf',
    '/Library/Fonts/NanumGothic.ttf',
  ];
  for (const f of fontCandidates) {
    if (fs.existsSync(f)) { fontPath = f; break; }
  }

  // 커스텀 폰트 체크
  const customFont = path.join(ASSETS_DIR, 'fonts', 'NanumGothicBold.ttf');
  if (fs.existsSync(customFont)) fontPath = customFont;

  const fontOpt = fontPath ? `:force_style='FontName=sans-serif,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,MarginV=30'` : '';

  execSync(
    `ffmpeg -y -i "${inputFile}" -vf "subtitles='${srtFile}'${fontOpt}" -c:a copy "${outputFile}" 2>/dev/null`,
    { timeout: 120000 }
  );

  console.log(`  ✅ 자막 합성 완료`);
  return outputFile;
}

// ─── BGM 합성 ───
function addBGM(inputFile, outputFile) {
  // BGM 파일 찾기
  const bgmDir = path.join(ASSETS_DIR, 'bgm');
  if (!fs.existsSync(bgmDir)) {
    console.log(`  ⏭️  BGM 폴더 없음, 건너뛰기`);
    fs.copyFileSync(inputFile, outputFile);
    return outputFile;
  }

  const bgmFiles = fs.readdirSync(bgmDir).filter(f => /\.(mp3|wav|m4a|aac)$/i.test(f));
  if (bgmFiles.length === 0) {
    console.log(`  ⏭️  BGM 파일 없음, 건너뛰기`);
    fs.copyFileSync(inputFile, outputFile);
    return outputFile;
  }

  // 랜덤 또는 첫 번째 BGM 선택
  const bgmFile = path.join(bgmDir, bgmFiles[Math.floor(Math.random() * bgmFiles.length)]);

  console.log(`  🎵 BGM 합성 중: ${path.basename(bgmFile)}`);

  // 영상 길이 확인
  const duration = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputFile}" 2>/dev/null`
  ).toString().trim();

  execSync(
    `ffmpeg -y -i "${inputFile}" -i "${bgmFile}" ` +
    `-filter_complex "[1:a]volume=0.15,afade=t=in:d=2,afade=t=out:st=${Math.max(0, parseFloat(duration) - 3)}:d=3[bgm];` +
    `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" ` +
    `-map 0:v -map "[aout]" -c:v copy -shortest "${outputFile}" 2>/dev/null`,
    { timeout: 120000 }
  );

  console.log(`  ✅ BGM 합성 완료`);
  return outputFile;
}

// ─── 에피소드 후처리 ───
async function processEpisode(episodeDir) {
  const metaFile = path.join(episodeDir, 'meta.json');
  if (!fs.existsSync(metaFile)) {
    console.log(`  ⏭️  meta.json 없음, 건너뛰기: ${episodeDir}`);
    return;
  }

  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  console.log(`\n🎬 후처리: ${meta.title}`);

  const sceneFiles = (meta.sceneFiles || []).filter(f => fs.existsSync(f));
  if (sceneFiles.length === 0) {
    console.log(`  ❌ 영상 파일이 없습니다.`);
    return;
  }

  // 1. 장면 병합 (파일이 여러 개인 경우)
  let videoFile;
  if (sceneFiles.length === 1) {
    videoFile = sceneFiles[0];
  } else {
    videoFile = mergeScenes(episodeDir, sceneFiles);
  }

  // 2. 자막 생성 + 합성
  const srtFile = path.join(episodeDir, 'subtitles.srt');
  const srtContent = generateSRT(meta.scenes || []);
  fs.writeFileSync(srtFile, srtContent, 'utf-8');

  const subtitledFile = path.join(episodeDir, 'subtitled.mp4');
  try {
    addSubtitles(videoFile, srtFile, subtitledFile);
    videoFile = subtitledFile;
  } catch (e) {
    console.log(`  ⚠️  자막 합성 실패 (건너뛰기): ${e.message}`);
  }

  // 3. BGM 합성
  const finalFile = path.join(episodeDir, 'final.mp4');
  try {
    addBGM(videoFile, finalFile);
  } catch (e) {
    console.log(`  ⚠️  BGM 합성 실패, 자막 버전으로 저장`);
    fs.copyFileSync(videoFile, finalFile);
  }

  // 4. 메타데이터 업데이트
  meta.finalFile = finalFile;
  meta.processedAt = new Date().toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  console.log(`  ✅ 최종 파일: ${finalFile}`);
}

// ─── 메인 ───
async function main() {
  console.log('🎬 막장 드라마 후처리 파이프라인');
  console.log('='.repeat(50));

  if (!checkFFmpeg()) process.exit(1);

  const targetId = process.argv[2];

  if (targetId) {
    const episodeDir = path.join(VIDEOS_DIR, targetId);
    if (!fs.existsSync(episodeDir)) {
      console.error(`❌ 디렉토리를 찾을 수 없습니다: ${episodeDir}`);
      process.exit(1);
    }
    await processEpisode(episodeDir);
    return;
  }

  // 모든 에피소드 처리
  if (!fs.existsSync(VIDEOS_DIR)) {
    console.error('❌ videos 폴더가 없습니다.');
    process.exit(1);
  }

  const episodes = fs.readdirSync(VIDEOS_DIR)
    .filter(d => fs.existsSync(path.join(VIDEOS_DIR, d, 'meta.json')));

  console.log(`\n📋 ${episodes.length}개 에피소드 후처리 시작\n`);

  for (const ep of episodes) {
    try {
      await processEpisode(path.join(VIDEOS_DIR, ep));
    } catch (e) {
      console.error(`❌ 후처리 실패 (${ep}): ${e.message}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ 전체 후처리 완료`);
}

main().catch(console.error);
