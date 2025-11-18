import { DataExportImport } from '@/components/DataExportImport'

export default function DataManagementPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">数据管理</h1>
        <p className="text-gray-600">
          导出和导入您的Offers、Campaigns等数据，支持JSON和CSV格式
        </p>
      </div>

      <DataExportImport />

      <div className="mt-8 p-6 bg-blue-50 rounded-lg">
        <h2 className="text-lg font-semibold mb-3">使用说明</h2>
        <div className="space-y-2 text-sm text-gray-700">
          <div>
            <strong>数据导出:</strong>
            <ul className="list-disc ml-6 mt-1 space-y-1">
              <li>选择要导出的数据类型（Offers或Campaigns）</li>
              <li>选择导出格式（JSON或CSV）</li>
              <li>点击"导出数据"按钮，文件将自动下载到本地</li>
            </ul>
          </div>

          <div className="mt-4">
            <strong>数据导入:</strong>
            <ul className="list-disc ml-6 mt-1 space-y-1">
              <li>准备好符合格式的JSON或CSV文件</li>
              <li>点击"选择文件"上传数据文件</li>
              <li>点击"导入数据"开始批量导入</li>
              <li>查看导入结果，包括成功和失败的记录</li>
            </ul>
          </div>

          <div className="mt-4">
            <strong>JSON格式示例:</strong>
            <pre className="bg-gray-100 p-3 rounded mt-2 text-xs overflow-x-auto">
{`[
  {
    "product_name": "示例产品",
    "product_url": "https://example.com/product",
    "target_country": "US",
    "target_language": "en",
    "offer_type": "cpc",
    "payout": 100,
    "cpc_estimate": 0.5,
    "is_active": true
  }
]`}
            </pre>
          </div>

          <div className="mt-4">
            <strong>CSV格式示例:</strong>
            <pre className="bg-gray-100 p-3 rounded mt-2 text-xs overflow-x-auto">
{`product_name,product_url,target_country,target_language,offer_type,payout,cpc_estimate,is_active
示例产品,https://example.com/product,US,en,cpc,100,0.5,true`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
