const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3400;
const DATA_DIR = path.join(__dirname, 'data');
const STORIES_FILE = path.join(DATA_DIR, 'stories.json');
const SELECTED_FILE = path.join(DATA_DIR, 'selected.json');

function loadStories() {
  if (!fs.existsSync(STORIES_FILE)) return [];
  return JSON.parse(fs.readFileSync(STORIES_FILE, 'utf-8'));
}

function loadSelected() {
  if (!fs.existsSync(SELECTED_FILE)) return [];
  return JSON.parse(fs.readFileSync(SELECTED_FILE, 'utf-8'));
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderPage(stories, selected) {
  const selectedIds = new Set(selected.map(s => s.id));
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Drama Factory - 스토리 선택</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d1117; color:#e6edf3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .header { padding:20px 30px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center; }
  .header h1 { font-size:20px; }
  .header .stats { color:#8b949e; font-size:14px; }
  .header button { background:#238636; color:#fff; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-size:14px; font-weight:600; }
  .header button:hover { background:#2ea043; }
  .container { display:flex; height:calc(100vh - 65px); }
  .list { width:45%; overflow-y:auto; border-right:1px solid #30363d; }
  .preview { width:55%; overflow-y:auto; padding:30px; }
  .story-item {
    padding:14px 20px; border-bottom:1px solid #21262d; cursor:pointer;
    display:flex; align-items:center; gap:12px; transition:background 0.1s;
  }
  .story-item:hover { background:#161b22; }
  .story-item.active { background:#1c2128; border-left:3px solid #58a6ff; }
  .story-item.selected-item { background:#1a2332; }
  .story-item input[type=checkbox] { width:18px; height:18px; accent-color:#58a6ff; cursor:pointer; flex-shrink:0; }
  .story-meta { flex:1; min-width:0; }
  .story-title { font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .story-info { font-size:12px; color:#8b949e; margin-top:4px; }
  .story-info span { margin-right:12px; }
  .preview-empty { display:flex; align-items:center; justify-content:center; height:100%; color:#484f58; font-size:16px; }
  .preview h2 { font-size:18px; margin-bottom:8px; }
  .preview .source { color:#58a6ff; font-size:13px; margin-bottom:16px; }
  .preview .content { line-height:1.8; font-size:14px; color:#c9d1d9; white-space:pre-wrap; }
  .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
  .badge-pann { background:#3a1d6e; color:#d2a8ff; }
  .badge-theqoo { background:#1a3a1a; color:#7ee787; }
  .selected-count { background:#58a6ff; color:#0d1117; padding:2px 10px; border-radius:12px; font-weight:700; margin-left:10px; }
  ::-webkit-scrollbar { width:8px; }
  ::-webkit-scrollbar-track { background:#0d1117; }
  ::-webkit-scrollbar-thumb { background:#30363d; border-radius:4px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Drama Factory <span style="color:#8b949e;font-weight:400">스토리 선택</span></h1>
    </div>
    <div style="display:flex;align-items:center;gap:16px">
      <span class="stats">${stories.length}개 스토리</span>
      <span class="selected-count" id="selCount">${selectedIds.size}개 선택됨</span>
      <button onclick="saveSelected()">💾 선택 저장</button>
      <button onclick="generateScripts()" style="background:#8957e5">🎬 스크립트 생성</button>
    </div>
  </div>
  <div class="container">
    <div class="list" id="storyList">
      ${stories.map((s, i) => `
        <div class="story-item ${selectedIds.has(s.id) ? 'selected-item' : ''}" data-idx="${i}" onclick="showPreview(${i})">
          <input type="checkbox" ${selectedIds.has(s.id) ? 'checked' : ''} onclick="event.stopPropagation();toggleSelect(${i})" id="cb${i}">
          <div class="story-meta">
            <div class="story-title">${esc(s.title)}</div>
            <div class="story-info">
              <span class="badge ${s.source === '네이트판' ? 'badge-pann' : 'badge-theqoo'}">${esc(s.source)}</span>
              <span>👀 ${(s.views || 0).toLocaleString()}</span>
              <span>📝 ${s.content.length}자</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="preview" id="preview">
      <div class="preview-empty">왼쪽에서 스토리를 클릭하세요</div>
    </div>
  </div>

  <script>
    const stories = ${JSON.stringify(stories)};
    const selected = new Set(${JSON.stringify([...selectedIds])});

    function showPreview(idx) {
      document.querySelectorAll('.story-item').forEach(el => el.classList.remove('active'));
      document.querySelector('[data-idx="'+idx+'"]').classList.add('active');
      const s = stories[idx];
      document.getElementById('preview').innerHTML =
        '<h2>'+s.title.replace(/</g,'&lt;')+'</h2>' +
        '<div class="source">'+s.source+' | 👀 '+(s.views||0).toLocaleString()+' | <a href="'+s.url+'" target="_blank" style="color:#58a6ff">원본 링크</a></div>' +
        '<div class="content">'+s.content.replace(/</g,'&lt;')+'</div>';
    }

    function toggleSelect(idx) {
      const id = stories[idx].id;
      const item = document.querySelector('[data-idx="'+idx+'"]');
      if (selected.has(id)) {
        selected.delete(id);
        item.classList.remove('selected-item');
      } else {
        selected.add(id);
        item.classList.add('selected-item');
      }
      document.getElementById('selCount').textContent = selected.size + '개 선택됨';
    }

    function saveSelected() {
      const data = stories.filter(s => selected.has(s.id));
      fetch('/api/save', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
      }).then(r => r.json()).then(r => {
        alert(r.message);
      });
    }

    function generateScripts() {
      if (selected.size === 0) { alert('스토리를 먼저 선택하세요'); return; }
      if (!confirm(selected.size + '개 스토리의 스크립트를 생성하시겠습니까?')) return;
      fetch('/api/generate-scripts', { method: 'POST' })
        .then(r => r.json())
        .then(r => alert(r.message));
    }
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      fs.writeFileSync(SELECTED_FILE, body, 'utf-8');
      const count = JSON.parse(body).length;
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ message: `${count}개 스토리 저장 완료!` }));
    });
    return;
  }

  if (url.pathname === '/api/generate-scripts' && req.method === 'POST') {
    const { execSync } = require('child_process');
    try {
      execSync('node generate-script.js', { cwd: __dirname, stdio: 'inherit' });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ message: '스크립트 생성 완료! data/scripts/ 폴더를 확인하세요.' }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ message: '스크립트 생성 실패: ' + e.message }));
    }
    return;
  }

  const stories = loadStories();
  const selected = loadSelected();
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(renderPage(stories, selected));
});

server.listen(PORT, () => {
  console.log(`\n🎬 Drama Factory 스토리 선택 UI`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   스토리: ${loadStories().length}개 로드됨\n`);
});
