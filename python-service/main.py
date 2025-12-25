"""
Google Ads API Service - 服务账号模式
处理所有需要服务账号认证的 Google Ads API 调用
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from google.ads.googleads.client import GoogleAdsClient
from google.oauth2 import service_account
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Google Ads Service Account API")


class ServiceAccountConfig(BaseModel):
    email: str
    private_key: str
    developer_token: str
    login_customer_id: str


class KeywordHistoricalMetricsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    keywords: List[str]
    language: str
    geo_target_constants: List[str]


class KeywordIdeasRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    keywords: List[str]
    language: str
    geo_target_constants: List[str]
    page_url: Optional[str] = None


def create_google_ads_client(sa_config: ServiceAccountConfig) -> GoogleAdsClient:
    """创建 Google Ads 客户端（服务账号认证）"""
    credentials = service_account.Credentials.from_service_account_info(
        {
            "type": "service_account",
            "client_email": sa_config.email,
            "private_key": sa_config.private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        },
        scopes=["https://www.googleapis.com/auth/adwords"],
    )

    return GoogleAdsClient.load_from_dict(
        {
            "developer_token": sa_config.developer_token,
            "use_proto_plus": True,
            "login_customer_id": sa_config.login_customer_id,
        },
        credentials=credentials,
    )


@app.post("/api/keyword-planner/historical-metrics")
async def get_keyword_historical_metrics(request: KeywordHistoricalMetricsRequest):
    """查询关键词历史数据"""
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordHistoricalMetricsRequest")
        request_obj.customer_id = request.customer_id.replace("-", "")
        request_obj.keywords.extend(request.keywords)
        request_obj.language = request.language
        request_obj.geo_target_constants.extend(request.geo_target_constants)
        request_obj.keyword_plan_network = (
            client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
        )

        response = keyword_plan_idea_service.generate_keyword_historical_metrics(
            request=request_obj
        )

        results = []
        for result in response.results:
            metrics = result.keyword_metrics
            results.append(
                {
                    "text": result.text,
                    "keyword_metrics": {
                        "avg_monthly_searches": metrics.avg_monthly_searches,
                        "competition": metrics.competition.name,
                        "competition_index": metrics.competition_index,
                        "low_top_of_page_bid_micros": metrics.low_top_of_page_bid_micros,
                        "high_top_of_page_bid_micros": metrics.high_top_of_page_bid_micros,
                    }
                    if metrics
                    else None,
                }
            )

        return {"results": results}

    except Exception as e:
        logger.error(f"Keyword historical metrics error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/keyword-planner/ideas")
async def get_keyword_ideas(request: KeywordIdeasRequest):
    """生成关键词建议"""
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordIdeasRequest")
        request_obj.customer_id = request.customer_id.replace("-", "")
        request_obj.language = request.language
        request_obj.geo_target_constants.extend(request.geo_target_constants)
        request_obj.keyword_plan_network = (
            client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
        )

        if request.page_url:
            request_obj.url_seed.url = request.page_url
        else:
            request_obj.keyword_seed.keywords.extend(request.keywords)

        response = keyword_plan_idea_service.generate_keyword_ideas(request=request_obj)

        results = []
        for idea in response.results:
            metrics = idea.keyword_idea_metrics
            results.append(
                {
                    "text": idea.text,
                    "keyword_idea_metrics": {
                        "avg_monthly_searches": metrics.avg_monthly_searches,
                        "competition": metrics.competition.name,
                        "competition_index": metrics.competition_index,
                        "low_top_of_page_bid_micros": metrics.low_top_of_page_bid_micros,
                        "high_top_of_page_bid_micros": metrics.high_top_of_page_bid_micros,
                    }
                    if metrics
                    else None,
                }
            )

        return {"results": results}

    except Exception as e:
        logger.error(f"Keyword ideas error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "ok"}


class GAQLQueryRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    query: str


@app.post("/api/google-ads/query")
async def execute_gaql_query(request: GAQLQueryRequest):
    """执行 GAQL 查询（用于 Performance Sync、Campaign 查询等）"""
    try:
        client = create_google_ads_client(request.service_account)
        ga_service = client.get_service("GoogleAdsService")

        response = ga_service.search(
            customer_id=request.customer_id.replace("-", ""), query=request.query
        )

        results = []
        for row in response:
            # 将 protobuf 对象转换为字典
            row_dict = {}
            for field in row._pb.DESCRIPTOR.fields:
                field_name = field.name
                if hasattr(row, field_name):
                    value = getattr(row, field_name)
                    # 处理嵌套对象
                    if hasattr(value, "_pb"):
                        nested_dict = {}
                        for nested_field in value._pb.DESCRIPTOR.fields:
                            nested_name = nested_field.name
                            if hasattr(value, nested_name):
                                nested_dict[nested_name] = getattr(value, nested_name)
                        row_dict[field_name] = nested_dict
                    else:
                        row_dict[field_name] = value
            results.append(row_dict)

        return {"results": results}

    except Exception as e:
        logger.error(f"GAQL query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
