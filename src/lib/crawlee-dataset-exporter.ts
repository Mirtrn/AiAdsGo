/**
 * Crawlee Dataset数据导出和管理工具
 *
 * 功能：
 * - Dataset数据导出（JSON/CSV/数据库格式）
 * - 数据清理和验证
 * - 数据合并和去重
 * - 批量数据处理
 */

import { Dataset } from '@crawlee/playwright';
import fs from 'fs/promises';
import path from 'path';

/**
 * Dataset导出格式
 */
export enum DatasetExportFormat {
  JSON = 'json',
  CSV = 'csv',
  DATABASE = 'database',
}

/**
 * Dataset数据项接口
 */
export interface DatasetItem {
  url: string;
  storeName: string | null;
  brandName: string | null;
  productCount: number;
  products: any[];
  timestamp: string;
  dataType?: 'success' | 'error';
}

/**
 * Dataset导出选项
 */
export interface DatasetExportOptions {
  format: DatasetExportFormat;
  outputPath?: string;
  clean?: boolean;
  deduplicate?: boolean;
  validate?: boolean;
  filter?: (item: DatasetItem) => boolean;
}

/**
 * Dataset统计信息
 */
export interface DatasetStats {
  totalItems: number;
  successItems: number;
  errorItems: number;
  totalProducts: number;
  uniqueStores: number;
  uniqueBrands: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

/**
 * Dataset导出工具类
 */
export class DatasetExporter {
  private datasetName: string;

  constructor(datasetName: string = 'default') {
    this.datasetName = datasetName;
  }

  /**
   * 导出Dataset数据
   *
   * @param options - 导出选项
   * @returns 导出的数据或文件路径
   */
  async export(options: DatasetExportOptions): Promise<any[] | string> {
    console.log(`📦 导出Dataset: ${this.datasetName}`);

    // 打开Dataset
    const dataset = await Dataset.open(this.datasetName);

    // 获取所有数据
    let items = await dataset.getData();
    console.log(`📊 Dataset总记录数: ${items.items.length}`);

    // 应用过滤器
    let data = items.items as DatasetItem[];
    if (options.filter) {
      data = data.filter(options.filter);
      console.log(`🔍 过滤后记录数: ${data.length}`);
    }

    // 数据清理
    if (options.clean) {
      data = this.cleanData(data);
      console.log(`🧹 清理后记录数: ${data.length}`);
    }

    // 数据去重
    if (options.deduplicate) {
      data = this.deduplicateData(data);
      console.log(`🔄 去重后记录数: ${data.length}`);
    }

    // 数据验证
    if (options.validate) {
      data = this.validateData(data);
      console.log(`✅ 验证后记录数: ${data.length}`);
    }

    // 根据格式导出
    switch (options.format) {
      case DatasetExportFormat.JSON:
        return this.exportJSON(data, options.outputPath);

      case DatasetExportFormat.CSV:
        return this.exportCSV(data, options.outputPath);

      case DatasetExportFormat.DATABASE:
        return this.formatForDatabase(data);

      default:
        throw new Error(`不支持的导出格式: ${options.format}`);
    }
  }

  /**
   * 获取Dataset统计信息
   */
  async getStats(): Promise<DatasetStats> {
    const dataset = await Dataset.open(this.datasetName);
    const items = await dataset.getData();
    const data = items.items as DatasetItem[];

    const successItems = data.filter((item) => item.dataType !== 'error');
    const errorItems = data.filter((item) => item.dataType === 'error');

    const totalProducts = successItems.reduce(
      (sum, item) => sum + (item.productCount || 0),
      0
    );

    const uniqueStores = new Set(
      successItems.map((item) => item.storeName).filter(Boolean)
    ).size;

    const uniqueBrands = new Set(
      successItems.map((item) => item.brandName).filter(Boolean)
    ).size;

    const timestamps = data.map((item) => item.timestamp).filter(Boolean);
    const dateRange = {
      earliest: timestamps.length > 0 ? timestamps.sort()[0] : '',
      latest: timestamps.length > 0 ? timestamps.sort().reverse()[0] : '',
    };

    return {
      totalItems: data.length,
      successItems: successItems.length,
      errorItems: errorItems.length,
      totalProducts,
      uniqueStores,
      uniqueBrands,
      dateRange,
    };
  }

  /**
   * 清理数据 - 移除空值和无效数据
   */
  private cleanData(data: DatasetItem[]): DatasetItem[] {
    return data.filter((item) => {
      // 至少要有URL或store信息
      if (!item.url && !item.storeName) return false;

      // 成功数据必须有产品
      if (item.dataType !== 'error' && (!item.products || item.products.length === 0)) {
        return false;
      }

      return true;
    });
  }

  /**
   * 去重数据 - 基于URL去重
   */
  private deduplicateData(data: DatasetItem[]): DatasetItem[] {
    const seenUrls = new Set<string>();
    const uniqueData: DatasetItem[] = [];

    for (const item of data) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueData.push(item);
      } else {
        console.log(`🔄 去重URL: ${item.url}`);
      }
    }

    return uniqueData;
  }

  /**
   * 验证数据 - 检查数据完整性
   */
  private validateData(data: DatasetItem[]): DatasetItem[] {
    return data.filter((item) => {
      // 验证URL格式
      if (item.url && !this.isValidUrl(item.url)) {
        console.warn(`⚠️ 无效URL: ${item.url}`);
        return false;
      }

      // 验证时间戳格式
      if (item.timestamp && !this.isValidTimestamp(item.timestamp)) {
        console.warn(`⚠️ 无效时间戳: ${item.timestamp}`);
        return false;
      }

      // 验证产品数量
      if (item.products && item.productCount !== item.products.length) {
        console.warn(
          `⚠️ 产品数量不匹配: ${item.productCount} vs ${item.products.length}`
        );
        item.productCount = item.products.length; // 修正
      }

      return true;
    });
  }

  /**
   * 导出为JSON格式
   */
  private async exportJSON(
    data: DatasetItem[],
    outputPath?: string
  ): Promise<any[] | string> {
    if (outputPath) {
      await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✅ JSON已导出: ${outputPath}`);
      return outputPath;
    }
    return data;
  }

  /**
   * 导出为CSV格式
   */
  private async exportCSV(
    data: DatasetItem[],
    outputPath?: string
  ): Promise<string> {
    // CSV头部
    const headers = [
      'URL',
      'Store Name',
      'Brand Name',
      'Product Count',
      'Timestamp',
    ];
    let csv = headers.join(',') + '\n';

    // CSV数据行
    data.forEach((item) => {
      const row = [
        this.escapeCsv(item.url || ''),
        this.escapeCsv(item.storeName || ''),
        this.escapeCsv(item.brandName || ''),
        item.productCount || 0,
        this.escapeCsv(item.timestamp || ''),
      ];
      csv += row.join(',') + '\n';
    });

    if (outputPath) {
      await fs.writeFile(outputPath, csv, 'utf-8');
      console.log(`✅ CSV已导出: ${outputPath}`);
      return outputPath;
    }

    return csv;
  }

  /**
   * 格式化为数据库可用格式
   */
  private formatForDatabase(data: DatasetItem[]): any[] {
    return data.map((item) => ({
      url: item.url,
      store_name: item.storeName,
      brand_name: item.brandName,
      product_count: item.productCount,
      products_json: JSON.stringify(item.products),
      created_at: item.timestamp,
      data_type: item.dataType || 'success',
    }));
  }

  /**
   * 清空Dataset
   */
  async clear(): Promise<void> {
    const dataset = await Dataset.open(this.datasetName);
    await dataset.drop();
    console.log(`🗑️  Dataset已清空: ${this.datasetName}`);
  }

  /**
   * 打印Dataset摘要
   */
  async printSummary(): Promise<void> {
    const stats = await this.getStats();

    console.log('\n📊 ========== Dataset统计摘要 ==========');
    console.log(`📦 数据集名称: ${this.datasetName}`);
    console.log(`📊 总记录数: ${stats.totalItems}`);
    console.log(`✅ 成功记录: ${stats.successItems}`);
    console.log(`❌ 错误记录: ${stats.errorItems}`);
    console.log(`📦 总产品数: ${stats.totalProducts}`);
    console.log(`🏪 唯一Store数: ${stats.uniqueStores}`);
    console.log(`🏷️  唯一品牌数: ${stats.uniqueBrands}`);

    if (stats.dateRange.earliest) {
      console.log(
        `📅 时间范围: ${stats.dateRange.earliest} - ${stats.dateRange.latest}`
      );
    }
    console.log('===========================================\n');
  }

  /**
   * 工具方法：验证URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 工具方法：验证时间戳
   */
  private isValidTimestamp(timestamp: string): boolean {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  }

  /**
   * 工具方法：CSV转义
   */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

/**
 * 快捷函数：导出默认Dataset为JSON
 */
export async function exportDatasetToJSON(outputPath: string): Promise<string> {
  const exporter = new DatasetExporter();
  return exporter.export({
    format: DatasetExportFormat.JSON,
    outputPath,
    clean: true,
    deduplicate: true,
    validate: true,
  }) as Promise<string>;
}

/**
 * 快捷函数：导出默认Dataset为CSV
 */
export async function exportDatasetToCSV(outputPath: string): Promise<string> {
  const exporter = new DatasetExporter();
  return exporter.export({
    format: DatasetExportFormat.CSV,
    outputPath,
    clean: true,
    deduplicate: true,
    validate: true,
  }) as Promise<string>;
}

/**
 * 快捷函数：获取默认Dataset统计
 */
export async function getDatasetStats(): Promise<DatasetStats> {
  const exporter = new DatasetExporter();
  return exporter.getStats();
}

/**
 * 快捷函数：打印默认Dataset摘要
 */
export async function printDatasetSummary(): Promise<void> {
  const exporter = new DatasetExporter();
  await exporter.printSummary();
}
