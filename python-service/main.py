"""
Google Ads API Service - 服务账号模式
处理所有需要服务账号认证的 Google Ads API 调用
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional
from google.ads.googleads.client import GoogleAdsClient
import logging
import json
import os
import tempfile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Google Ads Service Account API")


def format_customer_id(v: str) -> str:
    """统一格式化customer_id"""
    return v.replace("-", "").replace(" ", "")


def validate_login_customer_id(v: str) -> str:
    """验证并格式化 login_customer_id"""
    # 记录原始值（调试用）
    logger.info(f"Validating login_customer_id: original='{v}'")
    # 移除空格和横杠
    formatted = v.replace(' ', '').replace('-', '')
    # 验证必须是10位数字
    if not formatted.isdigit() or len(formatted) != 10:
        logger.error(f"Invalid login_customer_id: original='{v}', formatted='{formatted}'")
        raise ValueError(f"login_customer_id must be a 10-digit number, got: '{v}' (formatted: '{formatted}')")
    logger.info(f"Validated login_customer_id: formatted='{formatted}'")
    return formatted


class ServiceAccountConfig(BaseModel):
    email: str
    private_key: str
    developer_token: str
    login_customer_id: str = Field(..., description="Must be a 10-digit number without dashes or spaces")
    user_id: Optional[int] = Field(None, description="User ID for logging and tracking")

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

    @field_validator("customer_id", mode="before")
    @classmethod
    def format_customer_id_field(cls, v: str) -> str:
        return format_customer_id(v)


class KeywordIdeasRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    keywords: List[str]
    language: str
    geo_target_constants: List[str]
    page_url: Optional[str] = None

    @field_validator("customer_id", mode="before")
    @classmethod
    def format_customer_id_field(cls, v: str) -> str:
        return format_customer_id(v)


def create_google_ads_client(sa_config: ServiceAccountConfig) -> GoogleAdsClient:
    """创建 Google Ads 客户端（服务账号认证）"""
    service_account_info = {
        "type": "service_account",
        "client_email": sa_config.email,
        "private_key": sa_config.private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(service_account_info, f)
        json_key_file_path = f.name

    client = GoogleAdsClient.load_from_dict(
        {
            "developer_token": sa_config.developer_token,
            "use_proto_plus": True,
            "login_customer_id": sa_config.login_customer_id,
            "json_key_file_path": json_key_file_path,
        },
    )

    try:
        os.unlink(json_key_file_path)
    except Exception as e:
        logger.warning(f"清理临时文件失败: {e}")

    return client


# 🔧 修复(2025-12-27): 国家代码到 Geo Target Constant ID 的映射
# 参考: https://developers.google.com/google-ads/api/reference/data/geotargets
GEO_TARGET_MAP = {
    'US': 2840,   # United States
    'GB': 2826,   # United Kingdom
    'CA': 2124,   # Canada
    'AU': 2036,   # Australia
    'DE': 2276,   # Germany
    'FR': 2250,   # France
    'JP': 2392,   # Japan
    'CN': 2156,   # China
    'IN': 2356,   # India
    'BR': 2090,   # Brazil
    'MX': 2184,   # Mexico
    'ES': 2814,   # Spain
    'IT': 2297,   # Italy
    'NL': 2724,   # Netherlands
    'SE': 2818,   # Sweden
    'NO': 2754,   # Norway
    'DK': 2212,   # Denmark
    'FI': 1022,   # Finland
    'CH': 2810,   # Switzerland
    'AT': 2054,   # Austria
    'BE': 2060,   # Belgium
    'IE': 2284,   # Ireland
    'PT': 2794,   # Portugal
    'PL': 2782,   # Poland
    'CZ': 2202,   # Czech Republic
    'RU': 1023,   # Russia
    'KR': 1032,   # South Korea
    'SG': 2802,   # Singapore
    'HK': 2536,   # Hong Kong
    'TW': 2838,   # Taiwan
    'NZ': 2716,   # New Zealand
    'ZA': 2102,   # South Africa
    'AE': 2018,   # United Arab Emirates
    'SA': 2800,   # Saudi Arabia
}

# 语言代码到 Constant ID 的映射
LANGUAGE_CODE_MAP = {
    'en': 1000,      # English
    'zh': 1017,      # Chinese (Simplified)
    'zh-cn': 1017,   # Chinese (Simplified)
    'zh-tw': 1018,   # Chinese (Traditional)
    'ja': 1005,      # Japanese
    'de': 1001,      # German
    'fr': 1002,      # French
    'es': 1003,      # Spanish
    'it': 1004,      # Italian
    'ko': 1012,      # Korean
    'ru': 1031,      # Russian
    'pt': 1014,      # Portuguese
    'ar': 1019,      # Arabic
    'hi': 1023,      # Hindi
    'nl': 1020,      # Dutch
    'th': 1033,      # Thai
    'vi': 1044,      # Vietnamese
    'tr': 1037,      # Turkish
    'sv': 1032,      # Swedish
    'da': 1009,      # Danish
    'fi': 1011,      # Finnish
    'no': 1013,      # Norwegian
    'pl': 1021,      # Polish
    'cs': 1008,      # Czech
    'hu': 1024,      # Hungarian
    'el': 1022,      # Greek
    'he': 1025,      # Hebrew
    'id': 1027,      # Indonesian
    'ms': 1019,      # Malay
    'tl': 1034,      # Tagalog
}

# 语言名称到语言代码的映射
LANGUAGE_NAME_MAP = {
    'english': 'en',
    'chinese (simplified)': 'zh-cn',
    'chinese (traditional)': 'zh-tw',
    'chinese': 'zh',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'japanese': 'ja',
    'korean': 'ko',
    'portuguese': 'pt',
    'italian': 'it',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
    'dutch': 'nl',
    'thai': 'th',
    'vietnamese': 'vi',
    'turkish': 'tr',
    'swedish': 'sv',
    'danish': 'da',
    'finnish': 'fi',
    'norwegian': 'no',
    'polish': 'pl',
    'czech': 'cs',
    'hungarian': 'hu',
    'greek': 'el',
    'hebrew': 'he',
    'indonesian': 'id',
    'malay': 'ms',
}


def get_geo_target_constant_id(country_code: str) -> Optional[int]:
    """根据国家代码获取 Geo Target Constant ID"""
    return GEO_TARGET_MAP.get(country_code.upper())


def get_language_constant_id(language_input: str) -> Optional[int]:
    """根据语言输入获取 Language Constant ID"""
    lang = language_input.lower().strip()
    # 先尝试直接匹配代码
    if lang in LANGUAGE_CODE_MAP:
        return LANGUAGE_CODE_MAP[lang]
    # 再尝试匹配名称
    return LANGUAGE_CODE_MAP.get(LANGUAGE_NAME_MAP.get(lang, ''))


@app.post("/api/keyword-planner/historical-metrics")
async def get_keyword_historical_metrics(request: KeywordHistoricalMetricsRequest):
    """查询关键词历史数据"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordHistoricalMetricsRequest")
        request_obj.customer_id = request.customer_id
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
        logger.error(f"[user_id={user_id}] Keyword historical metrics error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/keyword-planner/ideas")
async def get_keyword_ideas(request: KeywordIdeasRequest):
    """生成关键词建议"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")

        request_obj = client.get_type("GenerateKeywordIdeasRequest")
        request_obj.customer_id = request.customer_id
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
        logger.error(f"[user_id={user_id}] Keyword ideas error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "ok"}


class ListAccessibleCustomersRequest(BaseModel):
    service_account: ServiceAccountConfig


@app.post("/api/google-ads/list-accessible-customers")
async def list_accessible_customers(request: ListAccessibleCustomersRequest):
    user_id = request.service_account.user_id
    """获取可访问的客户账户列表"""
    try:
        client = create_google_ads_client(request.service_account)
        customer_service = client.get_service("CustomerService")

        accessible_customers = customer_service.list_accessible_customers()
        resource_names = accessible_customers.resource_names

        return {"resource_names": list(resource_names)}

    except Exception as e:
        logger.error(f"[user_id={user_id}] List accessible customers error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class GAQLQueryRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    query: str


@app.post("/api/google-ads/query")
async def execute_gaql_query(request: GAQLQueryRequest):
    user_id = request.service_account.user_id
    """执行 GAQL 查询（用于 Performance Sync、Campaign 查询等）"""
    try:
        from google.protobuf.json_format import MessageToDict

        client = create_google_ads_client(request.service_account)
        ga_service = client.get_service("GoogleAdsService")

        # 🔧 修复(2025-12-26): 添加调试日志
        logger.info(f"[GAQL Query] login_customer_id={request.service_account.login_customer_id}, target_customer_id={request.customer_id}")

        response = ga_service.search(
            customer_id=request.customer_id, query=request.query
        )

        results = []
        for row in response:
            row_dict = MessageToDict(row._pb, preserving_proto_field_name=True)
            results.append(row_dict)

        return {"results": results}

    except Exception as e:
        error_str = str(e)
        # 🔧 修复(2025-12-26): 对预期内的错误返回空结果，而非500错误
        # 这些错误表示账户状态异常，查询预算返回空结果是合理的
        expected_errors = [
            "CUSTOMER_NOT_ENABLED",
            "PERMISSION_DENIED",
            "The customer account can't be accessed because it is not yet enabled or has been deactivated",
            "caller does not have permission"
        ]
        if any(err in error_str for err in expected_errors):
            logger.warn(f"[user_id={user_id}] GAQL query expected error (returning empty): {e}")
            return {"results": []}
        logger.error(f"[user_id={user_id}] GAQL query error: {e}")
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
    user_id = request.service_account.user_id
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
            customer_id=request.customer_id, operations=[operation]
        )

        return {"resource_name": response.results[0].resource_name}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Create campaign budget error: {e}")
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
    final_url_suffix: Optional[str] = None


@app.post("/api/google-ads/campaign/create")
async def create_campaign(request: CreateCampaignRequest):
    """创建搜索广告系列"""
    user_id = request.service_account.user_id
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

        # 🔧 修复(2025-12-27): 添加必填字段 contains_eu_political_advertising
        # 大多数Campaign不包含政治广告，设置为DOES_NOT_CONTAIN
        campaign.contains_eu_political_advertising = client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING

        # Geo target type
        campaign.geo_target_type_setting.positive_geo_target_type = (
            client.enums.PositiveGeoTargetTypeEnum.PRESENCE
        )

        # 🔧 修复(2025-12-27): 添加日期设置
        if request.start_date:
            campaign.start_date = request.start_date.replace('-', '')
        if request.end_date:
            campaign.end_date = request.end_date.replace('-', '')

        # 🔧 修复(2025-12-27): 添加 Final URL Suffix（与OAuth模式一致，即使为空也设置）
        campaign.final_url_suffix = request.final_url_suffix or ''

        response = campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        # 🔧 修复(2025-12-27): 添加地理位置和语言定位（与OAuth模式一致）
        campaign_resource_name = response.results[0].resource_name
        logger.info(f"[user_id={user_id}] Campaign创建成功: {campaign_resource_name}")

        # 添加地理位置定位
        if request.target_country:
            geo_target_id = get_geo_target_constant_id(request.target_country)
            if geo_target_id:
                try:
                    campaign_criterion_service = client.get_service("CampaignCriterionService")
                    geo_operation = client.get_type("CampaignCriterionOperation")
                    geo_criterion = geo_operation.create
                    geo_criterion.campaign = campaign_resource_name
                    geo_criterion.location.geo_target_constant = f"geoTargetConstants/{geo_target_id}"
                    campaign_criterion_service.mutate_campaign_criteria(
                        customer_id=request.customer_id, operations=[geo_operation]
                    )
                    logger.info(f"[user_id={user_id}] 添加地理位置定位: {request.target_country} ({geo_target_id})")
                except Exception as e:
                    logger.warning(f"[user_id={user_id}] 添加地理位置定位失败: {e}")

        # 添加语言定位
        if request.target_language:
            language_id = get_language_constant_id(request.target_language)
            if language_id:
                try:
                    campaign_criterion_service = client.get_service("CampaignCriterionService")
                    lang_operation = client.get_type("CampaignCriterionOperation")
                    lang_criterion = lang_operation.create
                    lang_criterion.campaign = campaign_resource_name
                    lang_criterion.language.language_constant = f"languageConstants/{language_id}"
                    campaign_criterion_service.mutate_campaign_criteria(
                        customer_id=request.customer_id, operations=[lang_operation]
                    )
                    logger.info(f"[user_id={user_id}] 添加语言定位: {request.target_language} ({language_id})")
                except Exception as e:
                    logger.warning(f"[user_id={user_id}] 添加语言定位失败: {e}")

        return {"resource_name": campaign_resource_name}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Create campaign error: {e}")
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
    user_id = request.service_account.user_id
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
            customer_id=request.customer_id, operations=[operation]
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
    user_id = request.service_account.user_id
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
            customer_id=request.customer_id, operations=operations
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
    final_url_suffix: Optional[str] = None
    path1: Optional[str] = None
    path2: Optional[str] = None


@app.post("/api/google-ads/responsive-search-ad/create")
async def create_responsive_search_ad(request: CreateResponsiveSearchAdRequest):
    """创建响应式搜索广告"""
    user_id = request.service_account.user_id
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

        # 🔧 修复(2025-12-27): 添加 Final URL Suffix
        if request.final_url_suffix:
            ad_group_ad.ad.final_url_suffix = request.final_url_suffix

        if request.path1:
            rsa.path1 = request.path1
        if request.path2:
            rsa.path2 = request.path2

        response = ad_group_ad_service.mutate_ad_group_ads(
            customer_id=request.customer_id, operations=[operation]
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
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name
        campaign.status = client.enums.CampaignStatusEnum[request.status]

        # 🔧 修复(2025-12-27): v22 直接设置 update_mask 路径列表
        operation.update_mask.paths.append("status")

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"Update campaign status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    cpc_bid_micros: Optional[int] = None
    target_cpa_micros: Optional[int] = None
    status: Optional[str] = None


@app.post("/api/google-ads/campaign/update")
async def update_campaign(request: UpdateCampaignRequest):
    """更新广告系列（支持 CPC、CPA、状态更新）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_service = client.get_service("CampaignService")

        operation = client.get_type("CampaignOperation")
        campaign = operation.update
        campaign.resource_name = request.campaign_resource_name

        # CPC 出价更新
        if request.cpc_bid_micros:
            campaign.target_spend.cpc_bid_ceiling_micros = request.cpc_bid_micros
            operation.update_mask.paths.append("target_spend.cpc_bid_ceiling_micros")

        # CPA 出价更新
        if request.target_cpa_micros:
            campaign.target_cpa.target_cpa_micros = request.target_cpa_micros
            operation.update_mask.paths.append("target_cpa.target_cpa_micros")

        # 状态更新
        if request.status:
            campaign.status = client.enums.CampaignStatusEnum[request.status]
            operation.update_mask.paths.append("status")

        campaign_service.mutate_campaigns(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update campaign error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateAdGroupRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    ad_group_resource_name: str
    cpc_bid_micros: Optional[int] = None


@app.post("/api/google-ads/adgroup/update")
async def update_ad_group(request: UpdateAdGroupRequest):
    """更新广告组（支持 CPC 出价更新）"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        ad_group_service = client.get_service("AdGroupService")

        operation = client.get_type("AdGroupOperation")
        ad_group = operation.update
        ad_group.resource_name = request.ad_group_resource_name

        # CPC 出价更新
        if request.cpc_bid_micros:
            ad_group.cpc_bid_micros = request.cpc_bid_micros
            operation.update_mask.paths.append("cpc_bid_micros")

        ad_group_service.mutate_ad_groups(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update ad group error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateCampaignBudgetRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    budget_amount_micros: int
    budget_resource_name: Optional[str] = None


@app.post("/api/google-ads/campaign/update-budget")
async def update_campaign_budget(request: UpdateCampaignBudgetRequest):
    """更新广告系列预算"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)
        campaign_budget_service = client.get_service("CampaignBudgetService")

        budget_resource_name = request.budget_resource_name

        # 如果未提供budget_resource_name，则查询获取
        if not budget_resource_name:
            ga_service = client.get_service("GoogleAdsService")
            query = f"""
                SELECT campaign.campaign_budget
                FROM campaign
                WHERE campaign.resource_name = '{request.campaign_resource_name}'
            """
            response = ga_service.search(
                customer_id=request.customer_id, query=query
            )
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

        # 🔧 修复(2025-12-27): v22 直接设置 update_mask 路径列表
        operation.update_mask.paths.append("amount_micros")

        campaign_budget_service.mutate_campaign_budgets(
            customer_id=request.customer_id, operations=[operation]
        )

        return {"success": True}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Update campaign budget error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateCalloutExtensionsRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    campaign_resource_name: str
    callout_texts: List[str]


@app.post("/api/google-ads/callout-extensions/create")
async def create_callout_extensions(request: CreateCalloutExtensionsRequest):
    """创建附加宣传信息"""
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)

        # 🔧 修复(2025-12-27): 过滤有效的callout文本（与OAuth模式一致）
        valid_callout_texts = [
            text for text in request.callout_texts
            if isinstance(text, str) and text.strip()
        ]
        if not valid_callout_texts:
            raise HTTPException(status_code=400, detail="没有有效的Callout文本，无法创建Callout扩展")

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for text in valid_callout_texts:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            # Google Ads限制：最多25个字符
            asset.callout_asset.callout_text = text[:25]
            asset_operations.append(operation)

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id, operations=asset_operations
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
            customer_id=request.customer_id,
            operations=campaign_asset_operations,
        )

        # 🔧 修复(2025-12-27): 返回 asset_resource_names 供 Node.js 解析
        return {"success": True, "asset_resource_names": [r.resource_name for r in asset_response.results]}

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
    user_id = request.service_account.user_id
    try:
        client = create_google_ads_client(request.service_account)

        # Create assets
        asset_service = client.get_service("AssetService")
        asset_operations = []
        for sitelink in request.sitelinks:
            operation = client.get_type("AssetOperation")
            asset = operation.create
            # Google Ads限制：link_text 最多25个字符
            asset.sitelink_asset.link_text = sitelink.link_text[:25] if sitelink.link_text else ''
            asset.final_urls.append(sitelink.final_url)
            # description1 和 description2 最多35个字符
            # 如果 description1 存在但 description2 不存在，用 description1 填充
            if sitelink.description1 and sitelink.description1.strip():
                asset.sitelink_asset.description1 = sitelink.description1[:35]
                asset.sitelink_asset.description2 = (sitelink.description2[:35] if sitelink.description2 else sitelink.description1[:35])
            asset_operations.append(operation)

        asset_response = asset_service.mutate_assets(
            customer_id=request.customer_id, operations=asset_operations
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
            customer_id=request.customer_id,
            operations=campaign_asset_operations,
        )

        # 🔧 修复(2025-12-27): 返回 asset_resource_names 供 Node.js 解析
        return {"success": True, "asset_resource_names": [r.resource_name for r in asset_response.results]}

    except Exception as e:
        logger.error(f"[user_id={user_id}] Create sitelink extensions error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class EnsureConversionGoalRequest(BaseModel):
    service_account: ServiceAccountConfig
    customer_id: str
    conversion_action_name: str


@app.post("/api/google-ads/conversion-goal/ensure")
async def ensure_conversion_goal(request: EnsureConversionGoalRequest):
    """确保转化目标存在"""
    user_id = request.service_account.user_id
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
            customer_id=request.customer_id, query=query
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
            customer_id=request.customer_id, operations=[operation]
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
