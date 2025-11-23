#!/usr/bin/env tsx

import { updateTaskStatus } from '../src/lib/optimization-tasks'

console.log('Testing updateTaskStatus function...\n')

// Test 1: Update to in_progress
console.log('Test 1: Update task 1 to in_progress')
try {
  const result1 = updateTaskStatus(1, 1, 'in_progress')
  console.log(`✅ Result: ${result1 ? 'SUCCESS' : 'FAILED'}\n`)
} catch (error: any) {
  console.log(`❌ Error: ${error.message}\n`)
}

// Test 2: Complete task with note
console.log('Test 2: Complete task 2 with note')
try {
  const result2 = updateTaskStatus(2, 1, 'completed', '已优化标题和描述，新创意已上线')
  console.log(`✅ Result: ${result2 ? 'SUCCESS' : 'FAILED'}\n`)
} catch (error: any) {
  console.log(`❌ Error: ${error.message}\n`)
}

// Test 3: Dismiss task with note
console.log('Test 3: Dismiss task 3 with note')
try {
  const result3 = updateTaskStatus(3, 1, 'dismissed', '决定继续观察，暂不执行')
  console.log(`✅ Result: ${result3 ? 'SUCCESS' : 'FAILED'}\n`)
} catch (error: any) {
  console.log(`❌ Error: ${error.message}\n`)
}

console.log('All tests completed!')
