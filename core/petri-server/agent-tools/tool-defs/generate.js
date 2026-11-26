/**
 * generate.* — 内核通用生成工具定义（provider 无关薄层）。
 *
 * petri-pack-create 立项（owner msg_74cac710da35）：内核只暴露通用签名，
 * 具体 provider（图像/视频/3D）由领域包经既有 buildToolRegistry.handlers 注入——
 * 不新增第三注册入口（harness 评估维度 E：两 registry 漂移结论）。
 * 纪律（block-86:43-57）：本文件零 provider/领域硬编码。
 */

function generateDefinition(name, description) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '生成目标的自然语言描述' },
          params: {
            type: 'object',
            description: 'provider 无关的生成参数字典（尺寸/时长/风格等由具体 provider 解释）',
            additionalProperties: true,
          },
          referenceArtifactId: {
            type: 'string',
            description: '可选：作为参考的既有 artifact id（图生图/图生视频）',
          },
        },
        required: ['prompt'],
      },
      // 返回统一 artifact 描述符：{ path, sha256, mime, source }，由包侧产生、artifact-truth 登记
      returns: { kind: 'artifact-descriptor', fields: ['path', 'sha256', 'mime', 'source'] },
    },
  };
}

module.exports = [
  generateDefinition('generate.image', '图像生成：返回可直接引用的图像 artifact 描述符；provider 由已安装领域包决定。'),
  generateDefinition('generate.video', '视频生成：返回视频 artifact 描述符；provider 由已安装领域包决定。'),
  generateDefinition('generate.model3d', '3D 生成：返回模型 artifact 描述符，可直接喂 3D 预览面板；provider 由已安装领域包决定。'),
];
