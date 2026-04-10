#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="http://localhost:3000"

echo -e "${YELLOW}=== UCAT User Creation Test ===${NC}\n"

# Step 1: Login
echo -e "${YELLOW}Step 1: Login as superadmin...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "superadmin",
    "password": "superadmin"
  }')

echo "Response: $LOGIN_RESPONSE"

# Extract token
TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo -e "${RED}✗ Login failed - no token received${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Login successful, Token: ${TOKEN:0:20}...${NC}\n"

# Step 2: Create a new user
echo -e "${YELLOW}Step 2: Creating new user...${NC}"
USER_NAME="Frontend Test User $(date +%s)"
USER_ID="frontendtest_$(date +%s)"

CREATE_RESPONSE=$(curl -s -X POST "$API_URL/api/superadmin/users" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$USER_NAME\",
    \"age\": 35,
    \"gender\": \"male\",
    \"employment_id\": \"EMP-FE-TEST-$(date +%s)\",
    \"role\": \"site_engineer\",
    \"user_id\": \"$USER_ID\",
    \"password\": \"testpass123\"
  }")

echo "Response: $CREATE_RESPONSE"

# Check if user was created
if echo "$CREATE_RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✓ User created successfully${NC}\n"
else
  echo -e "${RED}✗ User creation failed${NC}\n"
  exit 1
fi

# Step 3: Get all users
echo -e "${YELLOW}Step 3: Retrieving all users...${NC}"
GET_USERS_RESPONSE=$(curl -s -X GET "$API_URL/api/superadmin/users" \
  -H "Authorization: Bearer $TOKEN")

echo "Response (first 500 chars): ${GET_USERS_RESPONSE:0:500}"

# Check if new user appears in list
if echo "$GET_USERS_RESPONSE" | grep -q "$USER_ID"; then
  echo -e "\n${GREEN}✓ New user appears in users list${NC}"
else
  echo -e "\n${RED}✗ New user NOT found in users list${NC}"
  echo "Full response:"
  echo "$GET_USERS_RESPONSE"
  exit 1
fi

echo -e "\n${GREEN}=== All tests passed! ===${NC}"
