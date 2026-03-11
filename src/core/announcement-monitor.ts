import https from 'https';
import { isAnnouncementSeen, markAnnouncementSeen } from '../db/queries.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('announcements');

const BINANCE_CMS_URL = 'www.binance.com';
const ANNOUNCEMENT_PATH = '/bapi/composite/v1/public/cms/article/list/query';

/** Keywords that indicate BNB-relevant announcements worth alerting on */
const ALERT_KEYWORDS = [
  'hodler airdrop',
  'hodler airdrops',
  'launchpool',
  'megadrop',
  'bnb airdrop',
  'bnb holder',
];

interface BinanceArticle {
  id: number;
  code: string;
  title: string;
  releaseDate: number;
}

interface CmsResponse {
  data: {
    catalogs: Array<{
      articles: BinanceArticle[];
      catalogId: number;
      catalogName: string;
    }>;
  };
}

export class AnnouncementMonitor {
  private notify: (msg: string) => void;

  constructor(notify: (msg: string) => void) {
    this.notify = notify;
  }

  /** Check for new BNB-relevant announcements */
  async check(): Promise<void> {
    try {
      const articles = await this.fetchAnnouncements();
      const relevant = articles.filter((a) => this.isRelevant(a.title));

      for (const article of relevant) {
        if (isAnnouncementSeen(article.code)) continue;

        markAnnouncementSeen(article.code, article.title);
        log.info(`New announcement: ${article.title}`);

        const url = `https://www.binance.com/en/support/announcement/detail/${article.code}`;
        this.notify(
          `🔔 <b>Binance Announcement</b>\n\n` +
          `${article.title}\n\n` +
          `${url}`
        );
      }
    } catch (err) {
      log.warn('Failed to check announcements', err);
    }
  }

  /** Seed the DB with current announcements so only future ones trigger alerts */
  async seedExisting(): Promise<void> {
    try {
      const articles = await this.fetchAnnouncements();
      const relevant = articles.filter((a) => this.isRelevant(a.title));
      let seeded = 0;
      for (const article of relevant) {
        if (!isAnnouncementSeen(article.code)) {
          markAnnouncementSeen(article.code, article.title);
          seeded++;
        }
      }
      if (seeded > 0) {
        log.info(`Seeded ${seeded} existing announcements (won't re-alert)`);
      }
    } catch (err) {
      log.warn('Failed to seed existing announcements', err);
    }
  }

  private isRelevant(title: string): boolean {
    const lower = title.toLowerCase();
    return ALERT_KEYWORDS.some((kw) => lower.includes(kw));
  }

  private fetchAnnouncements(): Promise<BinanceArticle[]> {
    const body = JSON.stringify({
      type: 1,
      pageNo: 1,
      pageSize: 50,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: BINANCE_CMS_URL,
          path: ANNOUNCEMENT_PATH,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'BNBClaw/1.0',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            try {
              const parsed: CmsResponse = JSON.parse(data);
              const articles: BinanceArticle[] = [];
              for (const catalog of parsed.data?.catalogs ?? []) {
                for (const article of catalog.articles ?? []) {
                  articles.push(article);
                }
              }
              resolve(articles);
            } catch {
              reject(new Error(`Failed to parse announcement response: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(15_000, () => {
        req.destroy();
        reject(new Error('Announcement fetch timed out'));
      });
      req.write(body);
      req.end();
    });
  }
}
