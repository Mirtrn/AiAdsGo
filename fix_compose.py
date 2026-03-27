with open('/home/ubuntu/autoads/docker-compose.single.yml', 'r') as f:
    content = f.read()

content = content.replace(
    '      - autoads_network\n    depends_on:\n      - postgres',
    '      - autoads_network\n      - aiadsgo-network\n    depends_on:\n      - postgres'
)

if 'aiadsgo-network:' not in content:
    content = content.replace(
        'networks:\n  autoads_network:\n    driver: bridge',
        'networks:\n  autoads_network:\n    driver: bridge\n  aiadsgo-network:\n    external: true'
    )

with open('/home/ubuntu/autoads/docker-compose.single.yml', 'w') as f:
    f.write(content)
print('Done')
