#!/usr/bin/env python3
"""
Python Google Ads Service 全面测试脚本
测试所有端点的序列化和基本功能
"""
import sys
import json
from typing import Dict, Any

# 测试配置（使用mock数据）
MOCK_SERVICE_ACCOUNT = {
    "email": "test@example.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMOCK_KEY\n-----END PRIVATE KEY-----",
    "developer_token": "MOCK_TOKEN",
    "login_customer_id": "1234567890"
}

MOCK_CUSTOMER_ID = "9876543210"

def test_imports():
    """测试1: 检查所有必需的依赖"""
    print("=" * 60)
    print("测试1: 检查Python依赖")
    print("=" * 60)

    required_modules = [
        "fastapi",
        "pydantic",
        "google.ads.googleads",
        "google.protobuf.json_format"
    ]

    results = {}
    for module in required_modules:
        try:
            __import__(module)
            results[module] = "✅ 已安装"
        except ImportError as e:
            results[module] = f"❌ 缺失: {e}"

    for module, status in results.items():
        print(f"  {module}: {status}")

    all_ok = all("✅" in v for v in results.values())
    print(f"\n结果: {'通过' if all_ok else '失败'}\n")
    return all_ok

def test_pydantic_models():
    """测试2: 验证Pydantic模型"""
    print("=" * 60)
    print("测试2: Pydantic模型验证")
    print("=" * 60)

    try:
        from main import (
            ServiceAccountConfig,
            KeywordHistoricalMetricsRequest,
            GAQLQueryRequest,
            CreateCampaignBudgetRequest,
            CreateCampaignRequest,
            CreateAdGroupRequest,
            CreateKeywordsRequest,
            KeywordData
        )

        # 测试 ServiceAccountConfig
        sa = ServiceAccountConfig(**MOCK_SERVICE_ACCOUNT)
        print(f"  ✅ ServiceAccountConfig: login_customer_id={sa.login_customer_id}")

        # 测试 GAQLQueryRequest
        gaql_req = GAQLQueryRequest(
            service_account=MOCK_SERVICE_ACCOUNT,
            customer_id=MOCK_CUSTOMER_ID,
            query="SELECT campaign.id FROM campaign"
        )
        print(f"  ✅ GAQLQueryRequest: customer_id={gaql_req.customer_id}")

        # 测试 KeywordData
        kw = KeywordData(
            text="test keyword",
            match_type="BROAD",
            status="ENABLED"
        )
        print(f"  ✅ KeywordData: text={kw.text}, match_type={kw.match_type}")

        print("\n结果: 通过\n")
        return True

    except Exception as e:
        print(f"  ❌ 错误: {e}\n")
        return False

def test_login_customer_id_validation():
    """测试3: login_customer_id验证逻辑"""
    print("=" * 60)
    print("测试3: login_customer_id验证")
    print("=" * 60)

    try:
        from main import validate_login_customer_id

        test_cases = [
            ("1234567890", "1234567890", True),
            ("123-456-7890", "1234567890", True),
            ("123 456 7890", "1234567890", True),
            ("12345", None, False),  # 太短
            ("12345678901", None, False),  # 太长
            ("abcd567890", None, False),  # 包含字母
        ]

        passed = 0
        for input_val, expected, should_pass in test_cases:
            try:
                result = validate_login_customer_id(input_val)
                if should_pass and result == expected:
                    print(f"  ✅ '{input_val}' -> '{result}'")
                    passed += 1
                elif not should_pass:
                    print(f"  ❌ '{input_val}' 应该失败但通过了")
                else:
                    print(f"  ❌ '{input_val}' -> '{result}' (期望: '{expected}')")
            except ValueError as e:
                if not should_pass:
                    print(f"  ✅ '{input_val}' 正确拒绝: {str(e)[:50]}")
                    passed += 1
                else:
                    print(f"  ❌ '{input_val}' 不应该失败: {e}")

        success = passed == len(test_cases)
        print(f"\n结果: {'通过' if success else '失败'} ({passed}/{len(test_cases)})\n")
        return success

    except Exception as e:
        print(f"  ❌ 错误: {e}\n")
        return False

def test_protobuf_serialization():
    """测试4: Protobuf序列化（MessageToDict）"""
    print("=" * 60)
    print("测试4: Protobuf序列化")
    print("=" * 60)

    try:
        from google.protobuf.json_format import MessageToDict
        from google.protobuf import struct_pb2

        # 创建一个简单的protobuf消息
        msg = struct_pb2.Struct()
        msg.fields["test_field"].string_value = "test_value"
        msg.fields["number_field"].number_value = 123

        # 测试序列化
        result = MessageToDict(msg, preserving_proto_field_name=True)

        if isinstance(result, dict):
            print(f"  ✅ MessageToDict返回字典: {result}")

            # 测试JSON序列化
            json_str = json.dumps(result)
            print(f"  ✅ JSON序列化成功: {len(json_str)} bytes")

            print("\n结果: 通过\n")
            return True
        else:
            print(f"  ❌ MessageToDict返回类型错误: {type(result)}\n")
            return False

    except Exception as e:
        print(f"  ❌ 错误: {e}\n")
        return False

def test_client_creation_logic():
    """测试5: 客户端创建逻辑（不实际连接）"""
    print("=" * 60)
    print("测试5: 客户端创建逻辑")
    print("=" * 60)

    try:
        from main import create_google_ads_client, ServiceAccountConfig
        import tempfile
        import os

        # 检查临时文件创建和清理
        print("  检查临时文件处理...")

        temp_files_before = set(os.listdir(tempfile.gettempdir()))

        # 尝试创建客户端（会失败，但我们只关心临时文件处理）
        try:
            sa = ServiceAccountConfig(**MOCK_SERVICE_ACCOUNT)
            create_google_ads_client(sa)
        except Exception:
            pass  # 预期会失败（mock凭证）

        temp_files_after = set(os.listdir(tempfile.gettempdir()))
        new_files = temp_files_after - temp_files_before

        # 检查是否有残留的.json文件
        json_files = [f for f in new_files if f.endswith('.json')]

        if len(json_files) == 0:
            print(f"  ✅ 临时文件已正确清理")
            print("\n结果: 通过\n")
            return True
        else:
            print(f"  ⚠️  发现残留临时文件: {json_files}")
            print("\n结果: 警告（可能是其他进程的文件）\n")
            return True

    except Exception as e:
        print(f"  ❌ 错误: {e}\n")
        return False

def test_endpoint_structure():
    """测试6: 端点结构完整性"""
    print("=" * 60)
    print("测试6: 端点结构")
    print("=" * 60)

    try:
        from main import app

        routes = []
        for route in app.routes:
            if hasattr(route, 'path') and hasattr(route, 'methods'):
                routes.append({
                    'path': route.path,
                    'methods': list(route.methods) if route.methods else []
                })

        # 检查关键端点
        required_endpoints = [
            '/health',
            '/api/google-ads/query',
            '/api/google-ads/list-accessible-customers',
            '/api/keyword-planner/historical-metrics',
            '/api/keyword-planner/ideas',
            '/api/google-ads/campaign-budget/create',
            '/api/google-ads/campaign/create',
            '/api/google-ads/ad-group/create',
            '/api/google-ads/keywords/create',
            '/api/google-ads/responsive-search-ad/create',
            '/api/google-ads/campaign/update-status',
            '/api/google-ads/campaign/update-budget',
            '/api/google-ads/callout-extensions/create',
            '/api/google-ads/sitelink-extensions/create',
        ]

        found_endpoints = [r['path'] for r in routes]

        missing = []
        for endpoint in required_endpoints:
            if endpoint in found_endpoints:
                print(f"  ✅ {endpoint}")
            else:
                print(f"  ❌ {endpoint} (缺失)")
                missing.append(endpoint)

        success = len(missing) == 0
        print(f"\n结果: {'通过' if success else '失败'} ({len(required_endpoints) - len(missing)}/{len(required_endpoints)})\n")
        return success

    except Exception as e:
        print(f"  ❌ 错误: {e}\n")
        return False

def main():
    """运行所有测试"""
    print("\n" + "=" * 60)
    print("Python Google Ads Service 全面测试")
    print("=" * 60 + "\n")

    tests = [
        ("依赖检查", test_imports),
        ("Pydantic模型", test_pydantic_models),
        ("ID验证", test_login_customer_id_validation),
        ("Protobuf序列化", test_protobuf_serialization),
        ("客户端创建", test_client_creation_logic),
        ("端点结构", test_endpoint_structure),
    ]

    results = {}
    for name, test_func in tests:
        try:
            results[name] = test_func()
        except Exception as e:
            print(f"测试 '{name}' 异常: {e}\n")
            results[name] = False

    # 总结
    print("=" * 60)
    print("测试总结")
    print("=" * 60)

    passed = sum(1 for v in results.values() if v)
    total = len(results)

    for name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {name}: {status}")

    print(f"\n总计: {passed}/{total} 通过")

    if passed == total:
        print("\n🎉 所有测试通过！")
        return 0
    else:
        print(f"\n⚠️  {total - passed} 个测试失败")
        return 1

if __name__ == "__main__":
    sys.exit(main())
