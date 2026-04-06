const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT = path.join(DATA_DIR, 'stories.json');
const DELAY = 2000; // 요청 간 딜레이 (ms)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 네이트판 크롤러 ───
async function crawlNatePann(maxPages = 3) {
  const stories = [];
  console.log('\n📰 네이트판 인기글 크롤링 시작...');

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `https://pann.nate.com/talk/ranking?page=${page}`;
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(data);

      // 인기글 목록에서 링크 추출
      const postLinks = [];
      $('a[href*="/talk/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && /\/talk\/\d+/.test(href)) {
          const fullUrl = href.startsWith('http') ? href : `https://pann.nate.com${href}`;
          if (!postLinks.includes(fullUrl)) postLinks.push(fullUrl);
        }
      });

      console.log(`  페이지 ${page}: ${postLinks.length}개 링크 발견`);

      // 각 포스트 상세 크롤링
      for (const postUrl of postLinks.slice(0, 10)) {
        try {
          await sleep(DELAY);
          const { data: postHtml } = await axios.get(postUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept-Language': 'ko-KR,ko;q=0.9',
            },
            timeout: 10000,
          });

          const $p = cheerio.load(postHtml);
          const title = $p('h3.tit-txt, .post-tit, h2.title, .viewTitle').first().text().trim();
          const content = $p('.posting-content, .post-content, #contentArea, .txt_content').first().text().trim();
          const viewText = $p('.count, .hit, .viewCount').first().text().trim();
          const views = parseInt(viewText.replace(/[^0-9]/g, '')) || 0;

          if (title && content && content.length > 100) {
            const id = postUrl.match(/\/(\d+)/)?.[1] || Date.now().toString();
            stories.push({
              id: `pann_${id}`,
              source: '네이트판',
              title,
              content: content.slice(0, 3000),
              views,
              url: postUrl,
              crawledAt: new Date().toISOString(),
            });
            console.log(`    ✅ ${title.slice(0, 40)}... (${views}뷰)`);
          }
        } catch (e) {
          // 개별 포스트 실패는 무시
        }
      }
    } catch (e) {
      console.error(`  ❌ 페이지 ${page} 실패: ${e.message}`);
    }
    await sleep(DELAY);
  }

  return stories;
}

// ─── 더쿠 크롤러 ───
async function crawlTheqoo(maxPages = 3) {
  const stories = [];
  console.log('\n📰 더쿠 인기글 크롤링 시작...');

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `https://theqoo.net/hot?page=${page}`;
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Cookie': 'age_check=1',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(data);

      const postLinks = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && /document_srl=\d+|theqoo\.net\/\d+/.test(href)) {
          const fullUrl = href.startsWith('http') ? href : `https://theqoo.net${href}`;
          if (!postLinks.includes(fullUrl)) postLinks.push(fullUrl);
        }
      });

      // 목록에서 제목/조회수 직접 추출 시도
      $('tr, .li_wrap, .docList_row').each((_, el) => {
        const $el = $(el);
        const titleEl = $el.find('.title a, .doc_title a, td.title a').first();
        const title = titleEl.text().trim();
        const href = titleEl.attr('href');
        const viewText = $el.find('.count, .m_no, td:nth-child(4)').text().trim();
        const views = parseInt(viewText.replace(/[^0-9]/g, '')) || 0;

        if (title && href && title.length > 5) {
          const fullUrl = href.startsWith('http') ? href : `https://theqoo.net${href}`;
          const id = href.match(/(\d+)/)?.[1] || Date.now().toString();
          stories.push({
            id: `theqoo_${id}`,
            source: '더쿠',
            title,
            content: '',  // 상세 페이지 크롤링 필요시 추가
            views,
            url: fullUrl,
            crawledAt: new Date().toISOString(),
          });
        }
      });

      console.log(`  페이지 ${page}: ${stories.length}개 수집`);
    } catch (e) {
      console.error(`  ❌ 페이지 ${page} 실패: ${e.message}`);
    }
    await sleep(DELAY);
  }

  // 상세 본문 크롤링 (상위 20개만)
  const topStories = stories.filter(s => s.content === '').slice(0, 20);
  for (const story of topStories) {
    try {
      await sleep(DELAY);
      const { data } = await axios.get(story.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Cookie': 'age_check=1',
        },
        timeout: 10000,
      });
      const $ = cheerio.load(data);
      const content = $('.xe_content, .document_content, .rd_body').first().text().trim();
      if (content && content.length > 100) {
        story.content = content.slice(0, 3000);
        console.log(`    ✅ ${story.title.slice(0, 40)}...`);
      }
    } catch (e) {
      // 실패 무시
    }
  }

  return stories.filter(s => s.content.length > 100);
}

// ─── 메인 ───
async function main() {
  console.log('🎬 막장 드라마 스토리 수집기');
  console.log('=' .repeat(50));

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const pannStories = await crawlNatePann(3);
  const theqooStories = await crawlTheqoo(3);

  const allStories = [...pannStories, ...theqooStories];

  // 중복 제거 (제목 기준)
  const seen = new Set();
  const unique = allStories.filter(s => {
    if (seen.has(s.title)) return false;
    seen.add(s.title);
    return true;
  });

  // 조회수 기준 정렬
  unique.sort((a, b) => b.views - a.views);

  fs.writeFileSync(OUTPUT, JSON.stringify(unique, null, 2), 'utf-8');
  console.log(`\n✅ 총 ${unique.length}개 스토리 저장 → ${OUTPUT}`);
}

main().catch(console.error);
