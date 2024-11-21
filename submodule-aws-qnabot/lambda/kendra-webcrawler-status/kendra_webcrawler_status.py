import os
import json
import boto3
import functools


client = boto3.client('kendra')
ssm = boto3.client('ssm')


def handler(event, context):
    Name = os.environ.get('DATASOURCE_NAME')
    settings = get_settings()
    IndexId = settings['KENDRA_WEB_PAGE_INDEX']
    
    data_source_id = get_data_source_id(IndexId, Name)

    if data_source_id is None:
        return {"Status": 'NOTINDEXED'}
    else:
        return kendra_list_data_source_sync_jobs(IndexId, data_source_id)


def get_settings():
    default_settings_key = os.environ.get("DEFAULT_SETTINGS_PARAM")
    custom_settings_key = os.environ.get("CUSTOM_SETTINGS_PARAM")

    default_settings = ssm.get_parameter(Name=default_settings_key, WithDecryption=True)
    default_settings = json.loads(default_settings['Parameter']['Value'])
    custom_settings = ssm.get_parameter(Name=custom_settings_key, WithDecryption=True)
    custom_settings = json.loads(custom_settings['Parameter']['Value'])
    default_settings.update(custom_settings)

    return default_settings


def get_data_source_id(index_id, data_source_name):
    response = client.list_data_sources(
        IndexId=index_id,
        MaxResults=5
    )

    # filtered = filter(lambda item: item['Name'] == data_source_name, response['SummaryItems'])
    for item in response['SummaryItems']:
        if item['Name'] == data_source_name:
            return item['Id']
    return None


def kendra_list_data_source_sync_jobs(IndexId, data_source_id):
    #get information about a Kendra index data source
    response = client.describe_data_source(
        Id=data_source_id,
        IndexId=IndexId
    )
    data_source_status = response["Status"]

    #get information on the data sync jobs for a given data source
    response = client.list_data_source_sync_jobs(
        Id=data_source_id,
        IndexId=IndexId
    )
    # get current status by sorting the result by start time descending order
    if response['History'] != []:   #if there is data sync history
        latest_history_item = functools.reduce(lambda x, y: x if x['StartTime'] > y['StartTime'] else y, response['History'])

        result = list(map(lambda item: {'StartTime': item['StartTime'].strftime("%m/%d/%Y, %H:%M:%S"),
                                    'EndTime': item['EndTime'].strftime("%m/%d/%Y, %H:%M:%S") if 'EndTime' in item else '',
                                    'Status': item['Status'] if item['Status'] != "INCOMPLETE" else "COMPLETE WITH ERRORS",
                                    'ErrorMessage': item['ErrorMessage'] if 'ErrorMessage' in item else '',
                                    'Metrics': item['Metrics']
                                    }, response['History']))
        status = latest_history_item['Status']
    else: 
        result = ''
        status = data_source_status

    if data_source_status != 'ACTIVE':
        status = data_source_status

    response = {
                "Status": status,
                "History": result,
                "DashboardUrl": f'https://console.aws.amazon.com/cloudwatch/home?region={os.environ.get("AWS_REGION")}#dashboards:name={os.environ.get("DASHBOARD_NAME")}'
                }
    return response


