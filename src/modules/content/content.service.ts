import { Document } from 'mongodb';
import { AppError } from '../../core/error';
import { ContentRepository } from './content.repository';

interface ContentResponse {
  content: unknown[];
  total_content_count: number;
  page: number;
  page_size: number;
}

export class ContentService {
  constructor(private readonly repo: ContentRepository) {}

  async getContent(
    page: string,
    section: string,
    pageNum: number,
    pageSize: number,
  ): Promise<ContentResponse> {
    const cfg = await this.repo.findByPageSection(page, section);
    if (!cfg) throw AppError.notFound(`Content section '${page}/${section}' not found`);

    const allIds = cfg.content_order ?? [];
    const skip = (pageNum - 1) * pageSize;
    const pagedIds = allIds.slice(skip, skip + pageSize);

    const games = await this.repo.findGamesByIdentifications(pagedIds);

    const ordered = pagedIds
      .map((id) => games.find((g) => g['identification'] === id))
      .filter((g): g is Document => !!g);

    const content: unknown[] = cfg.field_mappings?.length
      ? ordered.map((g) => applyFieldMappings(g, cfg.field_mappings!))
      : ordered;

    return {
      content,
      total_content_count: allIds.length,
      page: pageNum,
      page_size: pageSize,
    };
  }
}

function applyFieldMappings(
  doc: Document,
  mappings: Array<{ response_key: string; db_path: string }>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { response_key, db_path } of mappings) {
    result[response_key] = getNestedValue(doc, db_path.split('.'));
  }
  return result;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
