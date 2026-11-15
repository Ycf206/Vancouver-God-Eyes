import { NextRequest } from 'next/server';
import { handleExploreOpenDataRequest } from '@/utils/opendataExploreProxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleExploreOpenDataRequest(request, {
    backendPath: '/api/explore/business-licences',
    datasetSlug: 'business-licences',
    cacheFilename: 'vancouver_business_licences.json',
    defaultSort: 'extract_desc',
    sortMap: {
      extract_desc: 'extractdate desc, issueddate desc',
      issued_desc: 'issueddate desc',
      issued_asc: 'issueddate asc',
      expired_desc: 'expireddate desc',
      employees_desc: 'numberofemployees desc',
    },
    filterFields: ['status', 'localarea', 'businesstype'],
    dateField: 'issueddate',
    dateIsDatetime: true,
  });
}
