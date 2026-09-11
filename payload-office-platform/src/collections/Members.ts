import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import type { FieldMaskRule } from '@/domain/auth/field-mask'
import {
  MEMBER_TOKEN_EXPIRATION_SECONDS,
  clearSessionsOnDisable,
  guardMemberCreate,
  guardMemberLogin,
  memberCollectionAccess,
} from '@/domain/member/member-access'
import { isValidCnMobile, maskPhone, normalizePhone } from '@/domain/shared/phone'

/** 缺 phone:full 时后台看到 138****1111；username 就是手机号。 */
const MEMBER_PHONE_MASK_RULE: FieldMaskRule = {
  field: 'username',
  requiredPermission: 'phone:full',
  mask: (value) => (typeof value === 'string' ? maskPhone(value) : value),
}

/**
 * 会员（OPT-088，母文档 §4.1）
 *
 * 是 Payload 的第二个 auth collection，但只借它的密码哈希、sessions 与锁定：
 *   - HTTP 入口全部在 src/app/api/member/*，Payload 自带的 /api/members/login 等被总路由封成 404；
 *   - 会话写在 cookie sbh-member-token，Payload 自带策略只认 payload-token，
 *     所以后台的 req.user 永远不会是会员；
 *   - 不要给本集合加 auth.strategies，加了会员就会进入后台 req.user。
 */
export const Members: CollectionConfig = {
  slug: 'members',
  labels: { singular: '会员', plural: '会员管理' },
  admin: {
    group: false,
    useAsTitle: 'username',
    defaultColumns: ['username', 'nickname', 'status', 'hasPassword', 'wechatBoundAt', 'lastLoginAt', 'createdAt'],
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    description: 'C 端注册用户。手机号是唯一身份键；停用后会话立即失效。',
  },
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
    tokenExpiration: MEMBER_TOKEN_EXPIRATION_SECONDS,
    useAPIKey: false,
    cookies: { secure: process.env.NODE_ENV === 'production' },
  },
  graphQL: false,
  trash: false,
  access: memberCollectionAccess,
  hooks: {
    beforeChange: [guardMemberCreate, clearSessionsOnDisable],
    beforeLogin: [guardMemberLogin],
    afterRead: createFieldMaskHooks([MEMBER_PHONE_MASK_RULE]),
  },
  fields: [
    {
      // 覆写 Payload 注入的 username：标签、校验、规范化。mergeBaseFields 会按 name 深合并。
      name: 'username',
      type: 'text',
      label: '手机号',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, description: '规范化 11 位手机号，注册后不可修改。' },
      access: { update: () => false },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !isValidCnMobile(value)) return '请输入正确的大陆手机号'
        return true
      },
      hooks: {
        beforeChange: [({ value }) => (typeof value === 'string' ? normalizePhone(value) : value)],
      },
    },
    { name: 'email', type: 'email', admin: { hidden: true } },
    { name: 'nickname', label: '昵称', type: 'text', maxLength: 30 },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          label: '状态',
          type: 'select',
          required: true,
          defaultValue: 'active',
          options: [
            { label: '启用', value: 'active' },
            { label: '停用', value: 'disabled' },
          ],
          admin: { description: '停用后旧会话立即失效。' },
        },
        { name: 'hasPassword', label: '已设密码', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
        { name: 'lastLoginAt', label: '最近登录', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'wechatUnionId', label: '微信 UnionID', type: 'text', unique: true, index: true, admin: { readOnly: true } },
        { name: 'wechatOpenId', label: '微信 OpenID', type: 'text', admin: { readOnly: true } },
        { name: 'wechatBoundAt', label: '微信绑定时间', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'consentPolicyVersion', label: '同意的隐私政策版本', type: 'text', required: true, admin: { readOnly: true } },
        { name: 'consentAcceptedAt', label: '同意时间', type: 'date', required: true, admin: { readOnly: true } },
      ],
    },
  ],
}
