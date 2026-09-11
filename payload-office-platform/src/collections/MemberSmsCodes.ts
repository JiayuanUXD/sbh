import type { CollectionConfig } from 'payload'

/** 验证码（OPT-088 §4.2）。后台隐藏、REST 全拒；只由服务端 Local API 读写；明文不落库。 */
export const MemberSmsCodes: CollectionConfig = {
  slug: 'member-sms-codes',
  labels: { singular: '会员验证码', plural: '会员验证码' },
  admin: { hidden: true },
  graphQL: false,
  trash: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'phone', type: 'text', required: true, index: true },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      options: [
        { label: '登录', value: 'login' },
        { label: '设置密码', value: 'set-password' },
        { label: '绑定微信', value: 'bind-wechat' },
      ],
    },
    { name: 'codeHash', type: 'text', required: true },
    { name: 'expiresAt', type: 'date', required: true, index: true },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0 },
    { name: 'consumedAt', type: 'date' },
    { name: 'ipHash', type: 'text' },
  ],
}
