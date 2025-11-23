const bcrypt = require('bcryptjs');

const currentHash = '$2b$10$xD6JKxPl.6/FFU4iRoAY9uGV138KIpC1ZCKjgcWjNiAfrlOmF5PoW';
const testPassword = '123456';

console.log('🔍 验证密码哈希...');
bcrypt.compare(testPassword, currentHash, (err, result) => {
  if (err) {
    console.error('❌ 错误:', err);
    return;
  }

  console.log(`✓ 密码 "${testPassword}" 是否匹配: ${result ? '是' : '否'}`);

  if (!result) {
    console.log('\n🔧 生成新的密码哈希...');
    bcrypt.hash(testPassword, 10, (err, newHash) => {
      if (err) {
        console.error('❌ 错误:', err);
        return;
      }
      console.log('新密码哈希:', newHash);
      console.log('\n📝 使用以下SQL更新密码:');
      console.log(`UPDATE users SET password_hash = '${newHash}' WHERE username = 'autoads';`);
    });
  } else {
    console.log('✅ 密码正确，无需重置');
  }
});
