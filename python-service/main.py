"""
Google Ads API Service - 服务账号模式
处理所有需要服务账号认证的 Google Ads API 调用
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional
from google.ads.googleads.client import GoogleAdsClient
from google.oauth2 import service_account
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Google Ads Service Account API")


def validate_login_customer_id(v: str) -> str:
    """验证并格式化 login_customer_id"""
    # 移除空格和横杠
    formatted = v.replace(' ', '').replace('-', '')
    # 验证必须是10位数字
    if not formatted.isdigit() or len(formatted) != 10:
        raise ValueError(f"login_customer_id must be a 10-digit number, got: '{v}' (formatted: '{formatted}')")
    return formatted


class ServiceAccountConfig(BaseModel):
    email: str
    private_key: str
    developer_token: str
    login_customer_id: str = Field(..., description="Must be a 10-digit number without dashes or spaces")

    @field_validator("login_customer_id", mode="before")
    @classmethod
    def validate_login_customer_id(cls, v: str) -> str:
        return validate_login_customer_id(v)


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
        credentials,
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


class ListAccessibleCustomersRequest(BaseModel):
    service_account: ServiceAccountConfig


@app.post("/api/google-ads/list-accessible-customers")
async def list_accessible_customers(request: ListAccessibleCustomersRequest):
    """获取可访问的客户账户列表"""
    try:
        client = create_google_ads_client(request.service_account)
        customer_service = client.get_service("CustomerService")

        accessible_customers = customer_service.list_accessible_customers()
        resource_names = accessible_customers.resource_names

        return {"resource_names": list(resource_names)}

    except Exception as e:
        logger.error(f"List accessible customers error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


class CreateCampaignBudgetRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    name: str
    amount_micros: int
    delivery_method: str  # "STANDARD" or "ACCELERATED"


@app.post("/api/google-ads/campaign-budget/create")
async def create_campaign_budget(request: CreateCampaignBudgetRequest):
    """创建广告系列预算"""
    try:
        client = create_google_ads_client(request.service_account)
        campaign_budget_service = client.get_service("CampaignBudgetService")

        operation = client.get_type("CampaignBudgetOperation")
        budget = operation.create
        budget.name = request.name
        budget.amount_micros = request.amount_micros
        budget.delivery_method = client.enums.BudgetDeliveryMethodEnum[
            request.delivery_method
        ]

        response = campaign_budget_service.mutate_campaign_budgets(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"Create campaign budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCampaignRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    name: str
    budget_resource_name: str
    status: str
    bidding_strategy_type: str
    cpc_bid_ceiling_micros: Optional[int] = None
    target_country: Optional[str] = None
    target_language: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


@app.post("/api/google-ads/campaign/create")
async def create_campaign(request: CreateCampaignRequest):
    """创建搜索广告系列"""
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.create
        campaign.name = request.name
        campaign.status = client.enums.CampaignStatusEnum[request.status]
        campaign.advertising_channel_type = (
            client.enums.AdvertisingChannelTypeEnum.SEARCH
        )
        campaign.campaign_budget = request.budget_resource_name

        # Network settings
        campaign.network_settings.target_google_search = True
        campaign.network_settings.target_search_network = True
        campaign.network_settings.target_content_network = False
        campaign.network_settings.target_partner_search_network = False

        # Bidding strategy
        campaign.bidding_strategy_type = client.enums.BiddingStrategyTypeEnum[
            request.bidding_strategy_type
        ]
        if request.cpc_bid_ceiling_micros:
            campaign.target_spend.cpc_bid_ceiling_micros = (
                request.cpc_bid_ceiling_micros
            )

        # Geo target type
        campaign.geo_target_type_setting.positive_geo_target_type = (
            client.enums.PositiveGeoTargetTypeEnum.PRESENCE
        )

        response = campaign_service.mutate_campaigns(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"Create campaign error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateAdGroupRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    name: str
    status: str
    cpc_bid_micros: Optional[int] = None


@app.post("/api/google-ads/ad-group/create")
async def create_ad_group(request: CreateAdGroupRequest):
    """创建广告组"""
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_service = client.get_service("AdGroupService")

        operation = client.get_type("AdGroupOperation")
        ad_group = operation.create
        ad_group.name = request.name
        ad_group.campaign = request.campaign_resource_name
        ad_group.status = client.enums.AdGroupStatusEnum[request.status]
        ad_group.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD

        if request.cpc_bid_micros:
            ad_group.cpc_bid_micros = request.cpc_bid_micros

        response = ad_group_service.mutate_ad_groups(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"Create ad group error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class KeywordData(BaseModel):
    text: str
    match_type: str
    status: str
    final_url: Optional[str] = None
    is_negative: bool = False


class CreateKeywordsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    keywords: List[KeywordData]


@app.post("/api/google-ads/keywords/create")
async def create_keywords(request: CreateKeywordsRequest):
    """批量创建关键词"""
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_criterion_service = client.get_service("AdGroupCriterionService")

        operations = []
        for kw in request.keywords:
            operation = client.get_type("AdGroupCriterionOperation")
            criterion = operation.create
            criterion.ad_group = request.ad_group_resource_name
            criterion.status = client.enums.AdGroupCriterionStatusEnum[kw.status]

            if kw.is_negative:
                criterion.negative = True

            criterion.keyword.text = kw.text
            criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[
                kw.match_type
            ]

            if kw.final_url:
                criterion.final_urls.append(kw.final_url)

            operations.append(operation)

        response = ad_group_criterion_service.mutate_ad_group_criteria(
            customer_id=request.customer_id.replace("-", ""), operations=operations
        )

        return {
            "results": [
                {"resource_name": result.resource_name} for result in response.results
            ]
        }

    except Exception as e:
        logger.error(f"Create keywords error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateResponsiveSearchAdRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    headlines: List[str]
    descriptions: List[str]
    final_urls: List[str]
    path1: Optional[str] = None
    path2: Optional[str] = None


@app.post("/api/google-ads/responsive-search-ad/create")
async def create_responsive_search_ad(request: CreateResponsiveSearchAdRequest):
    """创建响应式搜索广告"""
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_ad_service = client.get_service("AdGroupAdService")

        operation = client.get_type("AdGroupAdOperation")
        ad_group_ad = operation.create
        ad_group_ad.ad_group = request.ad_group_resource_name
        ad_group_ad.status = client.enums.AdGroupAdStatusEnum.ENABLED

        # Responsive search ad
        rsa = ad_group_ad.ad.responsive_search_ad
        for headline in request.headlines:
            headline_asset = client.get_type("AdTextAsset")
            headline_asset.text = headline
            rsa.headlines.append(headline_asset)

        for description in request.descriptions:
            desc_asset = client.get_type("AdTextAsset")
            desc_asset.text = description
            rsa.descriptions.append(desc_asset)

        ad_group_ad.ad.final_urls.extend(request.final_urls)

        if request.path1:
            rsa.path1 = request.path1
        if request.path2:
            rsa.path2 = request.path2

        response = ad_group_ad_service.mutate_ad_group_ads(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"Create responsive search ad error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignStatusRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    status: str


@app.post("/api/google-ads/campaign/update-status")
async def update_campaign_status(request: UpdateCampaignStatusRequest):
    """更新广告系列状态"""
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name
        campaign.status = client.enums.CampaignStatusEnum[request.status]

        field_mask = client.get_type("FieldMask")
        field_mask.paths.append("status")
        operation.update_mask.CopyFrom(field_mask)

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Update campaign status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignBudgetRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    budget_amount_micros: int


@app.post("/api/google-ads/campaign/update-budget")
async def update_campaign_budget(request: UpdateCampaignBudgetRequest):
    """更新广告系列预算"""
    try:
        client = create_google_ads_client(request.service_account)
        campaign_budget_service = client.get_service("CampaignBudgetService")

        # Get current budget resource name
        ga_service = client.get_service("GoogleAdsService")
        query = f"""
            SELECT campaign.campaign_budget
            FROM campaign
            WHERE campaign.resource_name = '{request.campaign_resource_name}'
        """
        response = ga_service.search(
            customer_id=request.customer_id.replace("-", ""), query=query
        )
        budget_resource_name = None
        for row in response:
            budget_resource_name = row.campaign.campaign_budget
            break

        if not budget_resource_name:
            raise Exception("Budget not found")

        # Update budget
        operation = client.get_type("CampaignBudgetOperation")
        budget = operation.update
        budget.resource_name = budget_resource_name
        budget.amount_micros = request.budget_amount_micros

        field_mask = client.get_type("FieldMask")
        field_mask.paths.append("amount_micros")
        operation.update_mask.CopyFrom(field_mask)

        campaign_budget_service.mutate_campaign_budgets(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Update campaign budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCalloutExtensionsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    callout_texts: List[str]


@app.post("/api/google-ads/callout-extensions/create")
async def create_callout_extensions(request: CreateCalloutExtensionsRequest):
    """创建附加宣传信息"""
    try:
        client = create_google_ads_client(request.service_account)

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for text in request.callout_texts:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            asset.callout_asset.callout_text = text
            asset_operations.append(operation)

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id.replace("-", ""), operations=asset_operations
        )

        # Link assets to campaign
        campaign_asset_service = client.get_service("CampaignAssetService")
        campaign_asset_operations = []
        for result in asset_response.results:
            operation = client.get_type("CampaignAssetOperation")
            campaign_asset = operation.create
            campaign_asset.campaign = request.campaign_resource_name
            campaign_asset.asset = result.resource_name
            campaign_asset.field_type = client.enums.AssetFieldTypeEnum.CALLOUT
            campaign_asset_operations.append(operation)

        campaign_asset_service.mutate_campaign_assets(
            customer_id=request.customer_id.replace("-", ""),
            operations=campaign_asset_operations,
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Create callout extensions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SitelinkData(BaseModel):
    link_text: str
    final_url: str
    description1: Optional[str] = None
    description2: Optional[str] = None


class CreateSitelinkExtensionsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    sitelinks: List[SitelinkData]


@app.post("/api/google-ads/sitelink-extensions/create")
async def create_sitelink_extensions(request: CreateSitelinkExtensionsRequest):
    """创建附加链接"""
    try:
        client = create_google_ads_client(request.service_account)

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for sitelink in request.sitelinks:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            asset.sitelink_asset.link_text = sitelink.link_text
            asset.final_urls.append(sitelink.final_url)
            if sitelink.description1:
                asset.sitelink_asset.description1 = sitelink.description1
            if sitelink.description2:
                asset.sitelink_asset.description2 = sitelink.description2
            asset_operations.append(operation)

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id.replace("-", ""), operations=asset_operations
        )

        # Link assets to campaign
        campaign_asset_service = client.get_service("CampaignAssetService")
        campaign_asset_operations = []
        for result in asset_response.results:
            operation = client.get_type("CampaignAssetOperation")
            campaign_asset = operation.create
            campaign_asset.campaign = request.campaign_resource_name
            campaign_asset.asset = result.resource_name
            campaign_asset.field_type = client.enums.AssetFieldTypeEnum.SITELINK
            campaign_asset_operations.append(operation)

        campaign_asset_service.mutate_campaign_assets(
            customer_id=request.customer_id.replace("-", ""),
            operations=campaign_asset_operations,
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Create sitelink extensions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class EnsureConversionGoalRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    conversion_action_name: str


@app.post("/api/google-ads/conversion-goal/ensure")
async def ensure_conversion_goal(request: EnsureConversionGoalRequest):
    """确保转化目标存在"""
    try:
        client = create_google_ads_client(request.service_account)
        ga_service = client.get_service("GoogleAdsService")

        # Check if conversion action exists
        query = f"""
            SELECT conversion_action.id, conversion_action.name
            FROM conversion_action
            WHERE conversion_action.name = '{request.conversion_action_name}'
        """
        response = ga_service.search(
            customer_id=request.customer_id.replace("-", ""), query=query
        )

        for row in response:
            return {"resource_name": row.conversion_action.resource_name}

        # Create if not exists
        conversion_action_service = client.get_service("ConversionActionService")
        operation = client.get_type("ConversionActionOperation")
        conversion_action = operation.create
        conversion_action.name = request.conversion_action_name
        conversion_action.type_ = (
            client.enums.ConversionActionTypeEnum.WEBPAGE
        )
        conversion_action.category = (
            client.enums.ConversionActionCategoryEnum.DEFAULT
        )
        conversion_action.status = client.enums.ConversionActionStatusEnum.ENABLED
        conversion_action.value_settings.default_value = 1.0
        conversion_action.value_settings.always_use_default_value = True

        result = conversion_action_service.mutate_conversion_actions(
            customer_id=request.customer_id.replace("-", ""), operations=[operation]
        )

        return {"resource_name": result.results[0].resource_name}

    except Exception as e:
        logger.error(f"Ensure conversion goal error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Conversion Goal Functions Removed ====================
#
# 🔧 移除说明 (2025-12-26):
# - UpdateCampaignConversionGoalRequest: 请求模型（已移除）
# - /api/google-ads/campaign-conversion-goal/update: 更新CampaignConversionGoal端点
#
# 原因: 对应的Node.js函数已移除，这些端点不再使用

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
