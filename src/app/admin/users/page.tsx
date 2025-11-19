'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import UserCreateModal from '@/components/admin/UserCreateModal'
import UserEditModal from '@/components/admin/UserEditModal'

interface User {
  id: number
  username: string
  email: string | null
  display_name: string
  role: string
  package_type: string
  valid_from: string
  valid_until: string
  is_active: number
  must_change_password: number
  last_login_at: string | null
  created_at: string
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  // 加载用户列表
  const loadUsers = async () => {
    try {
      setLoading(true)
      // HttpOnly Cookie自动携带，无需手动操作

      const queryParams = new URLSearchParams({
        page: page.toString(),
        pageSize: '10',
        search,
      })

      const response = await fetch(`/api/admin/users?${queryParams}`, {
        credentials: 'include', // HttpOnly Cookie自动携带
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '加载失败')
      }

      setUsers(data.data.users)
      setTotalPages(data.data.pagination.totalPages)
      setTotal(data.data.pagination.total)
    } catch (err: any) {
      setError(err.message || '加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [page, search])

  // 禁用/启用用户
  const toggleUserStatus = async (userId: number, currentStatus: number) => {
    if (!confirm(`确定要${currentStatus ? '禁用' : '启用'}该用户吗？`)) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          isActive: !currentStatus,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '操作失败')
      }

      alert('操作成功')
      loadUsers()
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  // 重置密码
  const resetPassword = async (userId: number) => {
    if (!confirm('确定要重置该用户密码为默认密码吗？\n默认密码: auto11@20ads')) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          resetPassword: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '重置失败')
      }

      alert('密码重置成功！\n新密码: auto11@20ads\n用户下次登录需强制修改密码')
    } catch (err: any) {
      alert(err.message || '重置密码失败')
    }
  }

  // 删除用户
  const deleteUser = async (userId: number, username: string) => {
    if (!confirm(`确定要删除用户 ${username} 吗？此操作不可恢复！`)) {
      return
    }

    try {
      // HttpOnly Cookie自动携带，无需手动操作
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include', // 确保发送cookie
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '删除失败')
      }

      alert('用户删除成功')
      loadUsers()
    } catch (err: any) {
      alert(err.message || '删除用户失败')
    }
  }

  // 格式化日期
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  // 套餐类型标签
  const getPackageLabel = (packageType: string) => {
    const labels: Record<string, string> = {
      trial: '试用',
      annual: '年卡',
      lifetime: '终身',
      enterprise: '私有化',
    }
    return labels[packageType] || packageType
  }

  // 套餐类型颜色
  const getPackageColor = (packageType: string) => {
    const colors: Record<string, string> = {
      trial: 'bg-gray-100 text-gray-800',
      annual: 'bg-blue-100 text-blue-800',
      lifetime: 'bg-green-100 text-green-800',
      enterprise: 'bg-purple-100 text-purple-800',
    }
    return colors[packageType] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* 标题栏 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">用户管理</h1>
          <p className="mt-2 text-sm text-gray-600">
            管理系统用户、套餐和权限
          </p>
        </div>

        {/* 操作栏 */}
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="w-full sm:w-96">
            <input
              type="text"
              placeholder="搜索用户名、邮箱或显示名称..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full sm:w-auto px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            + 创建用户
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* 用户列表 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent"></div>
            <p className="mt-2 text-gray-600">加载中...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500">暂无用户</p>
          </div>
        ) : (
          <div className="bg-white shadow overflow-hidden rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    用户信息
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    套餐
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    有效期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <div className="text-sm font-medium text-gray-900">
                          {user.username}
                          {user.role === 'admin' && (
                            <span className="ml-2 px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                              管理员
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500">{user.display_name}</div>
                        {user.email && (
                          <div className="text-xs text-gray-400">{user.email}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded ${getPackageColor(user.package_type)}`}>
                        {getPackageLabel(user.package_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div>{formatDate(user.valid_from)}</div>
                      <div className="text-xs text-gray-500">至 {formatDate(user.valid_until)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded ${
                        user.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.is_active ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingUser(user)
                            setShowEditModal(true)
                          }}
                          className="text-green-600 hover:text-green-900"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => toggleUserStatus(user.id, user.is_active)}
                          className="text-indigo-600 hover:text-indigo-900"
                          disabled={user.role === 'admin'}
                        >
                          {user.is_active ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => resetPassword(user.id)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          重置密码
                        </button>
                        <button
                          onClick={() => deleteUser(user.id, user.username)}
                          className="text-red-600 hover:text-red-900"
                          disabled={user.role === 'admin'}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                <div className="flex-1 flex justify-between sm:hidden">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                    className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-gray-700">
                      显示 <span className="font-medium">{(page - 1) * 10 + 1}</span> 到{' '}
                      <span className="font-medium">{Math.min(page * 10, total)}</span> 条，共{' '}
                      <span className="font-medium">{total}</span> 条
                    </p>
                  </div>
                  <div>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                      <button
                        onClick={() => setPage(page - 1)}
                        disabled={page === 1}
                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        上一页
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            pageNum === page
                              ? 'z-10 bg-indigo-50 border-indigo-500 text-indigo-600'
                              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      ))}
                      <button
                        onClick={() => setPage(page + 1)}
                        disabled={page === totalPages}
                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        下一页
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 创建用户弹窗 */}
        <UserCreateModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false)
            loadUsers()
          }}
        />

        {/* 编辑用户弹窗 */}
        {editingUser && (
          <UserEditModal
            isOpen={showEditModal}
            onClose={() => {
              setShowEditModal(false)
              setEditingUser(null)
            }}
            onSuccess={() => {
              setShowEditModal(false)
              setEditingUser(null)
              loadUsers()
            }}
            user={editingUser}
          />
        )}
      </div>
    </div>
  )
}
