import { NextRequest } from 'next/server';
import { handleExploreOpenDataRequest } from '@/utils/opendataExploreProxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleExploreOpenDataRequest(request, {
    backendPath: '/api/explore/building-permits',
    datasetSlug: 'issued-building-permits',
    cacheFilename: 'vancouver_building_permits.json',
    defaultSort: 'issuedate_desc',
    sortMap: {
      issuedate_desc: 'issuedate desc',
      issuedate_asc: 'issuedate asc',
      value_desc: 'projectvalue desc',
      value_asc: 'projectvalue asc',
    },
    filterFields: ['permitcategory', 'typeofwork', 'geolocalarea'],
    dateField: 'issuedate',
    dateIsDatetime: false,
  });
}
